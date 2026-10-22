import type { Logger } from "pino";

import { AiError } from "@/server/modules/ai/errors";
import type { AiGateway, AiObjectResult } from "@/server/modules/ai/gateway";
import { findTicketById, listMessages } from "@/server/modules/tickets/repository";
import { insertAuditEvent, type AuditEvent } from "@/server/platform/auth/audit";
import { getWorkspaceSettings } from "@/server/platform/auth/workspace-settings";
import { getDb } from "@/server/platform/db/client";
import { transaction } from "@/server/platform/db/tx";
import type { AiTriagePayload } from "@/server/platform/jobs/queues";
import { logger as defaultLogger } from "@/server/platform/logger";

import { decideTriage } from "./decide";
import {
  buildTriagePrompt,
  normalizeTriage,
  TRIAGE_PROMPT_VERSION,
  triageOutputSchema,
  type RawTriageOutput,
} from "./prompt";
import {
  applyTriageLabels,
  hasTriageRun,
  humanSetLabels,
  insertTriageRun,
  lockTicketLabels,
  type NewTriageRun,
} from "./repository";

/**
 * The ai.triage job (M5 D4, D5, D13): new ticket → model suggestion → labels applied or
 * "Needs review".
 *
 * Idempotent without relying on pg-boss deduplication: a ticket that already has a run is
 * skipped, both before the model call and again under the ticket lock before anything is
 * written, so two concurrent deliveries record one run.
 *
 * Outcomes:
 *  - succeeded: the run is stored; confident labels are applied (D5), audited as "system".
 *  - skipped (no retry): AI switched off, budget used up, daily cap reached, no categories.
 *  - failed: invalid output twice, the provider rejected the request, or the final attempt
 *    of a temporary failure. Temporary failures before that are thrown, so pg-boss retries.
 * A ticket that no longer exists is dropped without a record.
 */

export interface TriageDeps {
  gateway: AiGateway;
  logger?: Pick<Logger, "info" | "warn">;
}

export interface TriageAttempt {
  /** True when pg-boss will not retry this job again. */
  isFinalAttempt: boolean;
  /** Aborted by pg-boss when the job expires or the worker shuts down. */
  signal?: AbortSignal;
}

export type TriageOutcome =
  | { status: "succeeded"; applied: { category: boolean; priority: boolean }; needsReview: boolean }
  | { status: "failed" | "skipped"; errorCode: string }
  | { status: "dropped"; reason: "ticket_deleted" | "already_triaged" };

const SKIP_CODES = new Set(["ai_disabled", "ai_budget_exhausted", "ai_daily_limit"]);

const emptyRun = (status: "failed" | "skipped", errorCode: string, modelId?: string): NewTriageRun => ({
  status,
  errorCode,
  model: modelId ?? null,
  promptVersion: TRIAGE_PROMPT_VERSION,
});

/** Stores a failed or skipped run unless the ticket is gone or already has one. */
async function recordUnsuccessful(
  payload: AiTriagePayload,
  status: "failed" | "skipped",
  errorCode: string,
): Promise<boolean> {
  return transaction(async (tx) => {
    const locked = await lockTicketLabels(tx, payload.workspaceId, payload.ticketId);
    if (!locked || (await hasTriageRun(tx, payload.workspaceId, payload.ticketId))) return false;
    await insertTriageRun(tx, payload.workspaceId, payload.ticketId, emptyRun(status, errorCode));
    return true;
  });
}

export async function runTriageJob(
  payload: AiTriagePayload,
  attempt: TriageAttempt,
  deps: TriageDeps,
): Promise<TriageOutcome> {
  const log = deps.logger ?? defaultLogger;
  const { workspaceId, ticketId } = payload;
  const ids = { job: "ai.triage", workspaceId, ticketId };
  const db = getDb().db;

  const ticket = await findTicketById(workspaceId, ticketId);
  if (!ticket) return { status: "dropped", reason: "ticket_deleted" };
  if (await hasTriageRun(db, workspaceId, ticketId)) return { status: "dropped", reason: "already_triaged" };

  const settings = await getWorkspaceSettings(db, workspaceId);
  const categories = settings?.categories ?? [];
  if (categories.length === 0) {
    await recordUnsuccessful(payload, "skipped", "no_categories");
    return { status: "skipped", errorCode: "no_categories" };
  }

  const messages = await listMessages(workspaceId, ticketId, { includeInternal: false });
  const built = buildTriagePrompt({
    subject: ticket.subject,
    categories,
    messages: messages.flatMap((m) =>
      m.authorType === "system" ? [] : [{ from: m.authorType, body: m.body, internal: m.isInternal }],
    ),
  });
  if (built.flags.length)
    log.warn({ ...ids, flags: built.flags }, "hidden characters removed from triage input");

  const call = () =>
    deps.gateway.generateObject(
      { workspaceId, ticketId, signal: attempt.signal },
      {
        feature: "triage",
        system: built.system,
        prompt: built.prompt,
        schema: triageOutputSchema(categories),
      },
    );

  let result: AiObjectResult<RawTriageOutput>;
  try {
    try {
      result = await call();
    } catch (err) {
      // D4: invalid output is retried once, straight away (a fresh sample often parses).
      if (!(err instanceof AiError && err.code === "ai_invalid_output")) throw err;
      result = await call();
    }
  } catch (err) {
    if (!(err instanceof AiError)) throw err; // unexpected: let pg-boss retry, then dead-letter
    if (SKIP_CODES.has(err.code)) {
      await recordUnsuccessful(payload, "skipped", err.code);
      log.info({ ...ids, errorCode: err.code }, "triage skipped");
      return { status: "skipped", errorCode: err.code };
    }
    const retryable = err.temporary || err.code === "ai_aborted";
    if (retryable && !attempt.isFinalAttempt) throw err;
    await recordUnsuccessful(payload, "failed", err.code);
    log.warn({ ...ids, errorCode: err.code }, "triage failed");
    return { status: "failed", errorCode: err.code };
  }

  const suggestion = normalizeTriage(result.object);
  const threshold = settings?.triageConfidenceThreshold ?? 0.7;

  const outcome = await transaction(async (tx): Promise<TriageOutcome> => {
    const current = await lockTicketLabels(tx, workspaceId, ticketId);
    if (!current) return { status: "dropped", reason: "ticket_deleted" };
    if (await hasTriageRun(tx, workspaceId, ticketId))
      return { status: "dropped", reason: "already_triaged" };

    const decision = decideTriage({
      suggestion,
      current,
      humanSet: await humanSetLabels(tx, workspaceId, ticketId),
      threshold,
      flagged: built.flags.length > 0,
    });

    const labels: { category?: string; priority?: typeof suggestion.priority } = {};
    const events: AuditEvent[] = [];
    const event = (action: AuditEvent["action"], from: string | null, to: string): AuditEvent => ({
      workspaceId,
      actorUserId: null,
      actorType: "system",
      action,
      targetType: "ticket",
      targetId: ticketId,
      metadata: { number: current.number, from, to, source: "ai_triage", confidence: suggestion.confidence },
    });
    if (decision.applyCategory) {
      labels.category = suggestion.category;
      events.push(event("ticket.category_changed", current.category, suggestion.category));
    }
    if (decision.applyPriority) {
      labels.priority = suggestion.priority;
      events.push(event("ticket.priority_changed", current.priority, suggestion.priority));
    }
    if (events.length) {
      await applyTriageLabels(tx, workspaceId, ticketId, labels);
      for (const e of events) await insertAuditEvent(tx, e);
    }

    await insertTriageRun(tx, workspaceId, ticketId, {
      status: "succeeded",
      model: result.modelId,
      promptVersion: TRIAGE_PROMPT_VERSION,
      category: suggestion.category,
      priority: suggestion.priority,
      sentiment: suggestion.sentiment,
      language: suggestion.language,
      confidence: suggestion.confidence,
      reason: suggestion.reason,
      appliedCategory: decision.applyCategory,
      appliedPriority: decision.applyPriority,
      needsReview: decision.needsReview,
      latencyMs: Math.round(result.latencyMs), // the gateway measures fractional milliseconds
      flags: built.flags,
    });
    return {
      status: "succeeded",
      applied: { category: decision.applyCategory, priority: decision.applyPriority },
      needsReview: decision.needsReview,
    };
  });

  // Ids, decisions and numbers only: the model's reason can echo customer text (D11).
  log.info(
    {
      ...ids,
      outcome: outcome.status,
      ...(outcome.status === "succeeded"
        ? { applied: outcome.applied, needsReview: outcome.needsReview }
        : {}),
      confidence: suggestion.confidence,
      latencyMs: result.latencyMs,
      omittedMessages: built.omittedMessages,
    },
    "triage finished",
  );
  return outcome;
}

/** A job that exhausted its attempts or whose worker died: record the run as failed. */
export async function handleTriageDeadLetter(
  payload: AiTriagePayload,
  deps: { logger?: Pick<Logger, "warn"> } = {},
): Promise<boolean> {
  const changed = await recordUnsuccessful(payload, "failed", "dead_lettered");
  (deps.logger ?? defaultLogger).warn({ job: "ai.triage.dead", ...payload, changed }, "triage dead-lettered");
  return changed;
}
