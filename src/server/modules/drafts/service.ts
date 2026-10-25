import type { Logger } from "pino";

import { AiError, type AiErrorCode } from "@/server/modules/ai/errors";
import { createAiGatewayFromEnv, type AiGateway } from "@/server/modules/ai/gateway";
import { getAiPolicy } from "@/server/modules/ai/repository";
import { stripHiddenCharacters, type ThreadMessage } from "@/server/modules/ai/untrusted";
import { createEmbedderFromEnv, type Embedder } from "@/server/modules/kb/embedder";
import { KB_MAX_QUERY_LENGTH } from "@/server/modules/kb/limits";
import { DEFAULT_RETRIEVAL_MIN_SCORE } from "@/server/modules/kb/retrieval";
import { hybridSearch, type KbSearchResponse } from "@/server/modules/kb/service";
import { canAgentPost } from "@/server/modules/tickets/lifecycle";
import { findTicketById, listMessages, type Ticket } from "@/server/modules/tickets/repository";
import { ticketId as ticketIdSchema } from "@/server/modules/tickets/schemas";
import { mockTriageResponder } from "@/server/modules/triage/mock-responder";
import { findLatestTriage } from "@/server/modules/triage/repository";
import { requireWorkspace, type WorkspaceContext } from "@/server/platform/auth/context";
import { getWorkspaceSettings } from "@/server/platform/auth/workspace-settings";
import { getDb } from "@/server/platform/db/client";
import { transaction } from "@/server/platform/db/tx";
import { getEnv } from "@/server/platform/env";
import { AppError, Errors } from "@/server/platform/errors";
import { logger as defaultLogger } from "@/server/platform/logger";
import { annotateActiveSpan, SPAN_ATTRIBUTES, withSpan } from "@/server/platform/telemetry/spans";
import { consumeRateLimit, rateLimitKey, type RateLimitRule } from "@/server/platform/rate-limit";

import { mockDraftResponder } from "./mock-responder";
import { checkDraft, RefusalPrefixGuard } from "./postprocess";
import { buildDraftPrompt, DRAFT_PROMPT_VERSION, newCanary, type DraftPassage } from "./prompt";
import * as repo from "./repository";
import { apiDraft, type ApiDraft } from "./serialize";

/**
 * Reply drafts (M5 D6–D15): retrieval → refusal gate → prompt → stream → checks → save.
 *
 * `startDraft` does everything that can fail as an ordinary HTTP error first (sign-in,
 * permission, ticket, closed ticket, rate limits), then returns a stream of newline-delimited
 * JSON events (D6):
 *   {"type":"start","draftId"}            once, first
 *   {"type":"delta","text"}               zero or more, the text as it is written
 *   {"type":"done","draft"}               ready, refused (insufficient knowledge) or blocked
 *   {"type":"error","draftId","code",...} anything else; `retryable` says whether to offer a retry
 * The `done` draft is authoritative: the streamed text is a preview, before citation checks.
 *
 * Every outcome is saved in ai_draft. The model call itself is recorded in ai_usage by the
 * gateway; the draft row's timings are end to end (retrieval included), as the agent sees them.
 */

export const DRAFT_RATE_LIMITS = {
  /** Draft requests per user per workspace. */
  perUser: { windowSeconds: 600, max: 20 },
  /** Draft requests per workspace (backstop shared by all agents). */
  perWorkspace: { windowSeconds: 3600, max: 200 },
} satisfies Record<string, RateLimitRule>;

/** Codes in `error` events: the gateway's, plus the draft pipeline's own. */
export type DraftErrorCode =
  AiErrorCode | "retrieval_unavailable" | "retrieval_misconfigured" | "empty_output" | "internal_error";

/** Plain-language messages for agents. Provider error text is never shown (it can echo the request). */
const ERROR_MESSAGES: Record<DraftErrorCode, { message: string; retryable: boolean }> = {
  ai_disabled: {
    message: "AI drafting is turned off for this workspace. An admin can turn it on in AI settings.",
    retryable: false,
  },
  ai_budget_exhausted: {
    message: "This workspace has used its AI budget for this month. An admin can raise it in AI settings.",
    retryable: false,
  },
  ai_daily_limit: { message: "The daily AI limit has been reached. Try again tomorrow.", retryable: false },
  ai_unavailable: {
    message: "The AI service is temporarily unavailable. Try again in a moment.",
    retryable: true,
  },
  ai_timeout: { message: "The AI took too long to answer. Try again.", retryable: true },
  ai_invalid_output: { message: "The AI returned an unusable answer. Try again.", retryable: true },
  ai_rejected: {
    message: "The AI service rejected the request. Check the AI configuration.",
    retryable: false,
  },
  ai_aborted: { message: "Drafting was cancelled.", retryable: true },
  retrieval_unavailable: {
    message: "The knowledge base search is temporarily unavailable. Try again shortly.",
    retryable: true,
  },
  retrieval_misconfigured: {
    message: "The knowledge base must be re-embedded before drafts can use it.",
    retryable: false,
  },
  empty_output: { message: "The AI returned an empty answer. Try again.", retryable: true },
  internal_error: { message: "Something went wrong while drafting. Try again.", retryable: true },
};

export type DraftEvent =
  | { type: "start"; draftId: string }
  | { type: "delta"; text: string }
  | { type: "done"; draft: ApiDraft }
  | {
      type: "error";
      draftId: string;
      code: DraftErrorCode;
      message: string;
      retryable: boolean;
      retryAfterSeconds?: number;
    };

export function draftErrorEvent(draftId: string, code: DraftErrorCode, retryAfterMs?: number): DraftEvent {
  const { message, retryable } = ERROR_MESSAGES[code];
  return {
    type: "error",
    draftId,
    code,
    message,
    retryable,
    ...(retryAfterMs !== undefined ? { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) } : {}),
  };
}

class DraftPipelineError extends Error {
  constructor(readonly code: Exclude<DraftErrorCode, AiErrorCode>) {
    super(code);
  }
}

export interface DraftDeps {
  gateway?: AiGateway;
  embedder?: Embedder;
  logger?: Pick<Logger, "info" | "warn" | "error">;
  clock?: () => number;
}

// One gateway per web process: its circuit breakers must outlive single requests (D13).
const globalForDrafts = globalThis as unknown as {
  __spWebAiGateway?: AiGateway;
  __spDraftEmbedder?: Embedder;
};

function webGateway(): AiGateway {
  globalForDrafts.__spWebAiGateway ??= createAiGatewayFromEnv(getEnv(), getDb().db, {
    draft: mockDraftResponder,
    triage: mockTriageResponder,
  });
  return globalForDrafts.__spWebAiGateway;
}

function webEmbedder(): Embedder {
  globalForDrafts.__spDraftEmbedder ??= createEmbedderFromEnv(getEnv());
  return globalForDrafts.__spDraftEmbedder;
}

async function limit(
  scope: "draft-user" | "draft-workspace",
  key: string,
  ctx: WorkspaceContext,
  rule: RateLimitRule,
) {
  const result = await consumeRateLimit(key, rule);
  if (!result.allowed) {
    defaultLogger.warn(
      { event: "draft.rate_limited", scope, workspaceId: ctx.workspace.id },
      "draft rate limit hit",
    );
    throw Errors.tooManyRequests(result.retryAfterSeconds);
  }
}

export function draftRateLimitKeys(ctx: WorkspaceContext) {
  return {
    user: rateLimitKey("draft-user", ctx.workspace.id, ctx.user.id),
    workspace: rateLimitKey("draft-workspace", ctx.workspace.id),
  };
}

/** Subject plus the latest customer message (D7), as the retrieval query. */
export function retrievalQuery(subject: string, thread: readonly ThreadMessage[]): string {
  const latest = [...thread].reverse().find((m) => m.from === "customer" && !m.internal);
  const clean = (t: string) => stripHiddenCharacters(t).text.replace(/\s+/g, " ").trim();
  const subjectText = clean(subject);
  const body = clean(latest?.body ?? "");
  // A message that already contains its subject (customers often repeat it) is searched on its
  // own: the repeat adds no meaning but would push the rest of the message past the length cap.
  const repeats = subjectText !== "" && body.toLowerCase().includes(subjectText.toLowerCase());
  const text = repeats ? body : [subjectText, body].filter(Boolean).join(" ");
  return text.slice(0, KB_MAX_QUERY_LENGTH);
}

/** The best vector similarity among the results: the refusal gate's input (D7). */
export function topVectorScore(results: KbSearchResponse["results"]): number | null {
  const scores = results.flatMap((r) => (r.vector ? [r.vector.similarity] : []));
  return scores.length ? Math.max(...scores) : null;
}

/** Validates the request and returns the event stream. Throws AppError for HTTP-level failures. */
export async function startDraft(
  headers: Headers,
  rawTicketId: string,
  options: { signal?: AbortSignal; deps?: DraftDeps } = {},
): Promise<ReadableStream<Uint8Array>> {
  const ctx = await requireWorkspace(headers, { draft: ["generate"] });
  const parsed = ticketIdSchema.safeParse(rawTicketId);
  const ticket = parsed.success ? await findTicketById(ctx.workspace.id, parsed.data) : null;
  if (!ticket) throw Errors.notFound();
  if (!canAgentPost(ticket.status, false)) {
    throw Errors.conflict("This ticket is closed, so it can't receive a reply to draft.", "ticket_closed");
  }
  const keys = draftRateLimitKeys(ctx);
  await limit("draft-user", keys.user, ctx, DRAFT_RATE_LIMITS.perUser);
  await limit("draft-workspace", keys.workspace, ctx, DRAFT_RATE_LIMITS.perWorkspace);

  const draftId = await repo.insertDraft(getDb().db, ctx.workspace.id, {
    ticketId: ticket.id,
    requestedBy: ctx.user.id,
    promptVersion: DRAFT_PROMPT_VERSION,
  });
  return ndjsonStream(options.signal, (emit, signal) =>
    runDraft({ workspaceId: ctx.workspace.id, ticket, draftId, signal, emit }, options.deps ?? {}),
  );
}

/**
 * The same pipeline for operator tools (the AI evaluation script and the injection tests),
 * without the HTTP layer: no sign-in, permission check or rate limits, which the caller is
 * responsible for. Every outcome is saved exactly as for an agent. Returns all events.
 */
export async function runDraftPipeline(
  input: { workspaceId: string; ticketId: string; requestedBy: string | null; signal?: AbortSignal },
  deps: DraftDeps = {},
): Promise<DraftEvent[]> {
  const ticket = await findTicketById(input.workspaceId, input.ticketId);
  if (!ticket) throw Errors.notFound();
  const draftId = await repo.insertDraft(getDb().db, input.workspaceId, {
    ticketId: ticket.id,
    requestedBy: input.requestedBy,
    promptVersion: DRAFT_PROMPT_VERSION,
  });
  const events: DraftEvent[] = [];
  await runDraft(
    {
      workspaceId: input.workspaceId,
      ticket,
      draftId,
      signal: input.signal ?? new AbortController().signal,
      emit: (event) => void events.push(event),
    },
    deps,
  );
  return events;
}

type Emit = (event: DraftEvent) => void;

/**
 * Runs `run` and streams what it emits. When the client goes away (the request is aborted or
 * the stream cancelled), `signal` fires, which cancels the model call (D13), and `emit` throws.
 */
function ndjsonStream(
  requestSignal: AbortSignal | undefined,
  run: (emit: Emit, signal: AbortSignal) => Promise<void>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  requestSignal?.addEventListener("abort", () => abort.abort(), { once: true });
  let closed = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const emit: Emit = (event) => {
        if (closed || abort.signal.aborted) throw new Error("client disconnected");
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      void run(emit, abort.signal)
        .catch(() => {}) // runDraft handles its own errors; nothing may escape into the stream
        .finally(() => {
          if (closed) return;
          closed = true;
          controller.close();
        });
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });
}

interface RunInput {
  workspaceId: string;
  ticket: Ticket;
  draftId: string;
  signal: AbortSignal;
  emit: Emit;
}

/** One span per draft (plan M6 D7): ids, the outcome and the retrieval score, never text. */
function runDraft(input: RunInput, deps: DraftDeps): Promise<void> {
  return withSpan(
    "draft.generate",
    {
      [SPAN_ATTRIBUTES.workspaceId]: input.workspaceId,
      [SPAN_ATTRIBUTES.ticketId]: input.ticket.id,
      [SPAN_ATTRIBUTES.draftId]: input.draftId,
    },
    () => runDraftUntraced(input, deps),
  );
}

/** The customer-visible thread (no internal notes, no system lines) in prompt form. */
async function loadThread(workspaceId: string, ticketId: string): Promise<ThreadMessage[]> {
  const messages = await listMessages(workspaceId, ticketId, { includeInternal: false });
  return messages.flatMap((m) =>
    m.authorType === "system" ? [] : [{ from: m.authorType, body: m.body, internal: m.isInternal }],
  );
}

/** Hybrid KB search; a search failure becomes a draft error the agent can understand. */
async function retrieve(workspaceId: string, query: string, embedder: Embedder): Promise<KbSearchResponse> {
  try {
    return await hybridSearch(workspaceId, query, embedder);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    throw new DraftPipelineError(err.status === 503 ? "retrieval_unavailable" : "retrieval_misconfigured");
  }
}

/**
 * The citation rows for a ready draft: one per cited marker, with the passage copied at
 * generation time (D8) so it stays readable if the article is edited or deleted. Markers are
 * 1-based positions in `results` (checkDraft only keeps markers that exist).
 */
export function citationRows(cited: readonly number[], results: KbSearchResponse["results"]) {
  return cited.map((marker) => {
    const hit = results[marker - 1]!;
    return {
      marker,
      chunkId: hit.chunk.id,
      documentId: hit.document.id,
      documentTitle: hit.document.title,
      headingPath: hit.chunk.headingPath,
      content: hit.chunk.content,
      similarity: hit.vector?.similarity ?? null,
    };
  });
}

/**
 * How a failed run is recorded. AI and pipeline errors keep their own code. Anything else is a
 * cancellation if the client left (a disconnect makes `emit` throw a plain Error), otherwise a bug.
 */
export function draftFailure(
  err: unknown,
  aborted: boolean,
): { code: DraftErrorCode; status: "aborted" | "failed" } {
  const code: DraftErrorCode =
    err instanceof AiError || err instanceof DraftPipelineError
      ? err.code
      : aborted
        ? "ai_aborted"
        : "internal_error";
  return { code, status: code === "ai_aborted" ? "aborted" : "failed" };
}

async function runDraftUntraced(input: RunInput, deps: DraftDeps): Promise<void> {
  const { workspaceId: ws, ticket, draftId, signal, emit } = input;
  const log = deps.logger ?? defaultLogger;
  const clock = deps.clock ?? (() => performance.now());
  const db = getDb().db;
  const started = clock();
  const elapsed = () => Math.round(clock() - started);
  const ids = { event: "draft.finished", workspaceId: ws, ticketId: ticket.id, draftId };
  let topScore: number | null = null;

  /** The outcome on the draft's span: status and codes, never the text. */
  const traceOutcome = (outcome: Pick<repo.DraftOutcome, "status" | "errorCode" | "invalidCitationCount">) =>
    annotateActiveSpan({
      [SPAN_ATTRIBUTES.draftOutcome]: outcome.status,
      ...(outcome.errorCode ? { [SPAN_ATTRIBUTES.draftErrorCode]: outcome.errorCode } : {}),
      ...(outcome.invalidCitationCount === undefined
        ? {}
        : { [SPAN_ATTRIBUTES.draftInvalidCitations]: outcome.invalidCitationCount }),
      ...(topScore === null ? {} : { [SPAN_ATTRIBUTES.kbTopScore]: topScore }),
    });
  /** False when the draft was already finished (e.g. saved, then the client left). */
  const finish = (outcome: repo.DraftOutcome) => {
    traceOutcome(outcome);
    return repo.finishDraft(db, ws, draftId, {
      retrievalTopScore: topScore,
      latencyMs: elapsed(),
      ...outcome,
    });
  };
  const done = async () => {
    const saved = await repo.findDraft(db, ws, draftId);
    emit({ type: "done", draft: apiDraft(saved!.draft, saved!.citations) });
  };

  try {
    emit({ type: "start", draftId });

    // Before spending anything on retrieval: is AI on, and is there budget? (The gateway checks again.)
    const policy = await getAiPolicy(db, ws);
    if (!policy?.aiEnabled) throw new AiError("ai_disabled");
    if (policy.tokensUsedThisMonth >= policy.monthlyTokenBudget) throw new AiError("ai_budget_exhausted");

    const thread = await loadThread(ws, ticket.id);

    const embedder = deps.embedder ?? webEmbedder();
    const search = await retrieve(ws, retrievalQuery(ticket.subject, thread), embedder);
    topScore = topVectorScore(search.results);

    // D7: refuse without calling the model.
    const settings = await getWorkspaceSettings(db, ws);
    const minScore = embedder.similarityFloor ?? settings?.retrievalMinScore ?? DEFAULT_RETRIEVAL_MIN_SCORE;
    if (topScore === null || topScore < minScore) {
      const errorCode = search.results.length === 0 ? "no_passages" : "below_min_score";
      await finish({ status: "refused", errorCode });
      log.info(
        { ...ids, status: "refused", errorCode, topScore, minScore },
        "draft refused before the model",
      );
      await done();
      return;
    }

    const triage = await findLatestTriage(db, ws, ticket.id);
    const language = triage?.status === "succeeded" ? triage.language : null;
    const passages: DraftPassage[] = search.results.map((r, i) => ({
      marker: i + 1,
      documentTitle: r.document.title,
      headingPath: r.chunk.headingPath,
      content: r.chunk.content,
    }));
    const canary = newCanary();
    const built = buildDraftPrompt({ subject: ticket.subject, messages: thread, passages, language, canary });

    let ttftMs: number | null = null;
    const guard = new RefusalPrefixGuard();
    const result = await (deps.gateway ?? webGateway()).streamText(
      { workspaceId: ws, ticketId: ticket.id, signal },
      {
        feature: "draft",
        system: built.system,
        prompt: built.prompt,
        onDelta: (delta) => {
          const visible = guard.push(delta);
          if (!visible) return;
          ttftMs ??= elapsed();
          emit({ type: "delta", text: visible });
        },
      },
    );

    const check = checkDraft({
      text: result.text,
      passageCount: passages.length,
      canary,
      sources: [ticket.subject, ...thread.map((m) => m.body), ...passages.map((p) => p.content)],
      finishReason: result.finishReason,
      inputFlagged: built.flags.length > 0,
    });
    const usage = {
      model: result.modelId,
      language,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estCostMicros: result.usage.estCostMicros,
      ttftMs,
    };

    if (check.status === "failed") throw new DraftPipelineError(check.errorCode);
    if (check.status !== "ready") {
      await finish({ status: check.status, errorCode: check.errorCode, ...usage });
      const level = check.status === "blocked" ? "warn" : "info";
      log[level]({ ...ids, status: check.status, errorCode: check.errorCode, topScore }, "draft not offered");
      await done();
      return;
    }

    traceOutcome({ status: "ready", invalidCitationCount: check.invalidCitationCount });
    await transaction(async (tx) => {
      await repo.finishDraft(tx, ws, draftId, {
        status: "ready",
        body: check.body,
        invalidCitationCount: check.invalidCitationCount,
        warnings: check.warnings,
        retrievalTopScore: topScore,
        latencyMs: elapsed(),
        ...usage,
      });
      await repo.insertCitations(tx, ws, draftId, citationRows(check.cited, search.results));
    });
    // Ids, counts and timings only: never prompt or draft text (D11).
    log.info(
      {
        ...ids,
        status: "ready",
        topScore,
        passages: passages.length,
        cited: check.cited.length,
        invalidCitations: check.invalidCitationCount,
        warnings: check.warnings,
        unknownLinks: check.unknownLinkCount,
        omittedMessages: built.omittedMessages,
        ttftMs,
        latencyMs: elapsed(),
        outputTokens: result.usage.outputTokens,
      },
      "draft ready",
    );
    await done();
  } catch (err) {
    const { code, status } = draftFailure(err, signal.aborted);
    let recorded = false;
    try {
      recorded = await finish({ status, errorCode: code });
    } catch (finishErr) {
      log.error({ ...ids, err: finishErr }, "could not record the failed draft");
    }
    if (code === "internal_error") log.error({ ...ids, err }, "draft failed unexpectedly");
    else if (recorded) log.info({ ...ids, status, errorCode: code }, "draft failed");
    else log.info({ ...ids, errorCode: code }, "client left after the draft was saved");
    try {
      emit(draftErrorEvent(draftId, code, err instanceof AiError ? err.retryAfterMs : undefined));
    } catch {
      // The client is gone; the outcome is recorded.
    }
  }
}
