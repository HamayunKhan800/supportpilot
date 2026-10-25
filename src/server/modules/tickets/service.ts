import { getDb } from "@/server/platform/db/client";
import { transaction } from "@/server/platform/db/tx";
import { insertAuditEvent, type AuditEvent } from "@/server/platform/auth/audit";
import { requireWorkspace, type WorkspaceContext } from "@/server/platform/auth/context";
import { getWorkspaceSettings } from "@/server/platform/auth/workspace-settings";
import { getEnv } from "@/server/platform/env";
import { enqueueTriage } from "@/server/platform/jobs/boss";
import { Errors } from "@/server/platform/errors";
import { logger } from "@/server/platform/logger";
import { consumeRateLimit, rateLimitKey, type RateLimitRule } from "@/server/platform/rate-limit";
import { listMembers } from "@/server/modules/workspaces/repository";
import { DEFAULT_TRIAGE_CONFIDENCE_THRESHOLD } from "@/server/modules/triage/decide";
import * as triageRepo from "@/server/modules/triage/repository";
import { canAgentPost, canAgentTransition, canCustomerReply, statusAfterCustomerReply } from "./lifecycle";
import * as repo from "./repository";
import {
  agentMessageInput,
  ticketId,
  customerReplyInput,
  portalTicketInput,
  ticketListQuery,
  ticketNumber,
  ticketPatchInput,
  triageAcceptInput,
} from "./schemas";
import { generateTrackingToken, hashTrackingToken } from "./tracking-token";

/**
 * Ticket use cases. Every agent-facing function starts with `requireWorkspace` (role
 * from the database, T2) and passes the caller's workspace id to the repository (T1).
 * Unknown and foreign tickets are both "not found" (D6).
 */

export const PORTAL_LIMITS = {
  /** New tickets per client IP per workspace. */
  ticketsPerIp: { windowSeconds: 600, max: 5 },
  /** New tickets per workspace (backstop when IPs can't be trusted, see TRUST_PROXY_HEADERS). */
  ticketsPerWorkspace: { windowSeconds: 3600, max: 100 },
  /** Customer replies per ticket. */
  repliesPerTicket: { windowSeconds: 600, max: 10 },
} satisfies Record<string, RateLimitRule>;

async function limit(key: string, rule: RateLimitRule) {
  if (!getEnv().PORTAL_RATE_LIMIT_ENABLED) return;
  const result = await consumeRateLimit(key, rule);
  if (!result.allowed) {
    logger.warn({ event: "portal.rate_limited", scope: key.split(":")[0] }, "portal rate limit hit");
    throw Errors.tooManyRequests(result.retryAfterSeconds);
  }
}

const ticketEvent = (
  ws: string,
  ticketId: string,
  action: AuditEvent["action"],
  actor: { userId: string } | "customer",
  metadata: AuditEvent["metadata"],
): AuditEvent => ({
  workspaceId: ws,
  actorUserId: actor === "customer" ? null : actor.userId,
  actorType: actor === "customer" ? "customer" : "user",
  action,
  targetType: "ticket",
  targetId: ticketId,
  metadata,
});

// ---------------------------------------------------------------------------
// Customer portal (no account; the tracking token is the credential)
// ---------------------------------------------------------------------------

export async function getPortal(slug: string) {
  const ws = await repo.findWorkspaceBySlug(slug);
  if (!ws) throw Errors.notFound();
  return { name: ws.name, slug: ws.slug };
}

/**
 * FR-T1. Returns the raw tracking token exactly once; only its hash is stored.
 * Honeypot hits get a normal-looking response but nothing is saved.
 */
export async function createPortalTicket(
  slug: string,
  rawInput: unknown,
  ip: string,
): Promise<{ token: string }> {
  const input = portalTicketInput.parse(rawInput);
  const ws = await repo.findWorkspaceBySlug(slug);
  if (!ws) throw Errors.notFound();

  await limit(rateLimitKey("portal-ip", ws.id, ip), PORTAL_LIMITS.ticketsPerIp);
  await limit(rateLimitKey("portal-ws", ws.id), PORTAL_LIMITS.ticketsPerWorkspace);

  if (input.website) {
    logger.info({ event: "portal.honeypot", workspaceId: ws.id }, "honeypot submission dropped");
    return { token: generateTrackingToken().token };
  }

  const { token, hash } = generateTrackingToken();
  const created = await transaction(async (tx) => {
    const t = await repo.insertTicket(tx, ws.id, {
      subject: input.subject,
      customerName: input.name,
      customerEmail: input.email,
      accessTokenHash: hash,
      firstMessage: input.message,
    });
    await insertAuditEvent(tx, ticketEvent(ws.id, t.id, "ticket.created", "customer", { number: t.number }));
    // M5 D4: the triage job commits with the ticket, or not at all.
    await enqueueTriage(tx, { workspaceId: ws.id, ticketId: t.id });
    return t;
  });
  logger.info({ event: "ticket.created", workspaceId: ws.id, ticketId: created.id }, "ticket created");
  return { token };
}

async function ticketForToken(token: string) {
  const hash = hashTrackingToken(token);
  const t = hash ? await repo.findTicketByTokenHash(hash) : null;
  if (!t) throw Errors.notFound();
  return t;
}

/** FR-T2. What the customer sees: no internal notes, no assignee, no internal ids. */
export async function getCustomerTicket(token: string) {
  const t = await ticketForToken(token);
  const [messages, workspaceName] = await Promise.all([
    repo.listMessages(t.workspaceId, t.id, { includeInternal: false }),
    repo.findWorkspaceName(t.workspaceId),
  ]);
  return {
    workspaceName: workspaceName ?? "Support",
    number: t.number,
    subject: t.subject,
    status: t.status,
    createdAt: t.createdAt,
    canReply: canCustomerReply(t.status),
    messages: messages.map((m) => ({
      id: m.id,
      from: m.authorType === "customer" ? ("customer" as const) : ("support" as const),
      authorName: m.authorType === "agent" ? m.authorName : null,
      body: m.body,
      createdAt: m.createdAt,
    })),
  };
}

/** FR-T2 + D2: a reply reopens a pending/resolved ticket. Closed tickets refuse replies. */
export async function addCustomerReply(token: string, rawInput: unknown): Promise<void> {
  const input = customerReplyInput.parse(rawInput);
  const t = await ticketForToken(token);
  await limit(rateLimitKey("portal-reply", t.id), PORTAL_LIMITS.repliesPerTicket);

  await transaction(async (tx) => {
    const locked = await repo.lockTicket(tx, t.workspaceId, t.id);
    if (!locked) throw Errors.notFound();
    if (!canCustomerReply(locked.status)) {
      throw Errors.conflict("This request is closed. Please submit a new request.");
    }
    await repo.insertMessage(tx, t.workspaceId, t.id, {
      authorType: "customer",
      authorUserId: null,
      body: input.message,
      isInternal: false,
    });
    const next = statusAfterCustomerReply(locked.status);
    if (next !== locked.status) {
      await repo.setStatus(tx, t.workspaceId, t.id, next);
      await insertAuditEvent(
        tx,
        ticketEvent(t.workspaceId, t.id, "ticket.status_changed", "customer", {
          number: locked.number,
          from: locked.status,
          to: next,
          reason: "customer_reply",
        }),
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Agents (owner / admin / agent)
// ---------------------------------------------------------------------------

/** FR-T3. Queue with filters, search and keyset paging. */
export async function listTicketsForAgent(headers: Headers, rawQuery: unknown) {
  const ctx = await requireWorkspace(headers, { ticket: ["read"] });
  const q = ticketListQuery.parse(rawQuery);
  const assignee = q.assignee === "me" ? ctx.user.id : q.assignee;
  const page = await repo.listTickets(ctx.workspace.id, {
    status: q.status,
    priority: q.priority,
    category: q.category,
    assignee,
    q: q.q,
    sort: q.sort,
    limit: q.limit,
    afterId: q.after,
    needsReview: q.needsReview === "true",
  });
  return { ctx, ...page };
}

async function ticketDetail(ctx: WorkspaceContext, t: repo.Ticket) {
  const [messages, members, settings, triage] = await Promise.all([
    repo.listMessages(ctx.workspace.id, t.id, { includeInternal: true }),
    listMembers(ctx.workspace.id),
    getWorkspaceSettings(getDb().db, ctx.workspace.id),
    triageRepo.findLatestTriage(getDb().db, ctx.workspace.id, t.id),
  ]);
  return {
    ctx,
    ticket: t,
    messages,
    triage,
    assignees: members.map((m) => ({ id: m.userId, name: m.name })),
    categories: settings?.categories ?? [],
    triageThreshold: settings?.triageConfidenceThreshold ?? DEFAULT_TRIAGE_CONFIDENCE_THRESHOLD,
  };
}

/** Malformed ids are "not found" (never a database cast error / 500). */
function parseId(id: string): string {
  const parsed = ticketId.safeParse(id);
  if (!parsed.success) throw Errors.notFound();
  return parsed.data;
}

export async function getTicketForAgent(headers: Headers, rawId: string) {
  const ctx = await requireWorkspace(headers, { ticket: ["read"] });
  const t = await repo.findTicketById(ctx.workspace.id, parseId(rawId));
  if (!t) throw Errors.notFound();
  return ticketDetail(ctx, t);
}

/** For page URLs like /app/tickets/12 (numbers are per workspace). */
export async function getTicketByNumberForAgent(headers: Headers, rawNumber: unknown) {
  const ctx = await requireWorkspace(headers, { ticket: ["read"] });
  const parsed = ticketNumber.safeParse(rawNumber);
  const t = parsed.success ? await repo.findTicketByNumber(ctx.workspace.id, parsed.data) : null;
  if (!t) throw Errors.notFound();
  return ticketDetail(ctx, t);
}

/** FR-T4, FR-T5, FR-T6. One audit entry per changed field, in the same transaction. */
export async function updateTicketForAgent(headers: Headers, rawId: string, rawPatch: unknown) {
  const ctx = await requireWorkspace(headers, { ticket: ["update"] });
  const id = parseId(rawId);
  const patch = ticketPatchInput.parse(rawPatch);
  const ws = ctx.workspace.id;

  const current = await repo.findTicketById(ws, id);
  if (!current) throw Errors.notFound();
  if (current.version !== patch.version) throw staleConflict();

  const changes: repo.TicketPatch = {};
  const events: AuditEvent[] = [];
  const actor = { userId: ctx.user.id };
  const meta = { number: current.number };

  if (patch.status !== undefined && patch.status !== current.status) {
    if (!canAgentTransition(current.status, patch.status)) {
      throw Errors.conflict(`A ${current.status} request can't be moved to ${patch.status}.`);
    }
    changes.status = patch.status;
    events.push(
      ticketEvent(ws, id, "ticket.status_changed", actor, {
        ...meta,
        from: current.status,
        to: patch.status,
      }),
    );
  }
  if (patch.priority !== undefined && patch.priority !== current.priority) {
    changes.priority = patch.priority;
    events.push(
      ticketEvent(ws, id, "ticket.priority_changed", actor, {
        ...meta,
        from: current.priority,
        to: patch.priority,
      }),
    );
  }
  if (patch.category !== undefined && patch.category !== current.category) {
    if (patch.category !== null) {
      const settings = await getWorkspaceSettings(getDb().db, ws);
      if (!settings?.categories.includes(patch.category)) {
        throw Errors.badRequest("Unknown category.", {
          category: ["Choose one of the workspace's categories."],
        });
      }
    }
    changes.category = patch.category;
    events.push(
      ticketEvent(ws, id, "ticket.category_changed", actor, {
        ...meta,
        from: current.category,
        to: patch.category,
      }),
    );
  }
  if (patch.assigneeId !== undefined && patch.assigneeId !== current.assigneeId) {
    changes.assigneeId = patch.assigneeId;
    events.push(ticketEvent(ws, id, "ticket.assigned", actor, { ...meta, to: patch.assigneeId }));
  }

  if (events.length === 0) return current; // nothing actually changed

  try {
    return await transaction(async (tx) => {
      const updated = await repo.updateTicket(tx, ws, id, patch.version, changes);
      if (!updated) throw staleConflict();
      for (const e of events) await insertAuditEvent(tx, e);
      if (changes.category !== undefined || changes.priority !== undefined) {
        // D5: an agent's choice reviews the AI's suggestion and is kept as an override.
        await triageRepo.recordAgentDecision(tx, ws, id, ctx.user.id, {
          category: changes.category,
          priority: changes.priority,
        });
      }
      return updated;
    });
  } catch (err) {
    if (sqlState(err) === "23503") {
      throw Errors.badRequest("Assignee must be a member of this workspace.", {
        assigneeId: ["Choose a member of this workspace."],
      });
    }
    throw err;
  }
}

/**
 * FR-AI2, D5: an agent accepts the AI's suggested category and priority. Same rules as a manual
 * edit (version check, one audit entry per changed field, as the agent), and the run is marked
 * reviewed even when the labels were already applied.
 */
export async function acceptTriageSuggestion(headers: Headers, rawId: string, rawInput: unknown) {
  const ctx = await requireWorkspace(headers, { ticket: ["update"] });
  const id = parseId(rawId);
  const input = triageAcceptInput.parse(rawInput);
  const ws = ctx.workspace.id;

  if (!(await repo.findTicketById(ws, id))) throw Errors.notFound();
  const triage = await triageRepo.findLatestTriage(getDb().db, ws, id);
  if (triage?.status !== "succeeded" || !triage.category || !triage.priority) {
    throw Errors.conflict("There is no AI suggestion to accept for this request.");
  }
  const suggestion = { category: triage.category, priority: triage.priority };
  const settings = await getWorkspaceSettings(getDb().db, ws);
  if (!settings?.categories.includes(suggestion.category)) {
    throw Errors.conflict("The suggested category no longer exists. Choose a category instead.");
  }

  await transaction(async (tx) => {
    const current = await triageRepo.lockTicketLabels(tx, ws, id);
    if (!current) throw Errors.notFound();
    if (current.version !== input.version) throw staleConflict();

    const changes: repo.TicketPatch = {};
    const events: AuditEvent[] = [];
    const actor = { userId: ctx.user.id };
    const meta = { number: current.number, source: "ai_suggestion" };
    if (current.category !== suggestion.category) {
      changes.category = suggestion.category;
      events.push(
        ticketEvent(ws, id, "ticket.category_changed", actor, {
          ...meta,
          from: current.category,
          to: suggestion.category,
        }),
      );
    }
    if (current.priority !== suggestion.priority) {
      changes.priority = suggestion.priority;
      events.push(
        ticketEvent(ws, id, "ticket.priority_changed", actor, {
          ...meta,
          from: current.priority,
          to: suggestion.priority,
        }),
      );
    }
    if (events.length) {
      if (!(await repo.updateTicket(tx, ws, id, input.version, changes))) throw staleConflict();
      for (const e of events) await insertAuditEvent(tx, e);
    }
    await triageRepo.recordAgentDecision(tx, ws, id, ctx.user.id, suggestion);
  });

  const updated = await repo.findTicketById(ws, id);
  if (!updated) throw Errors.notFound();
  return updated;
}

/** FR-T5. Public reply or internal note. */
export async function addAgentMessage(headers: Headers, rawId: string, rawInput: unknown) {
  const ctx = await requireWorkspace(headers, { ticket: ["update"] });
  const id = parseId(rawId);
  const input = agentMessageInput.parse(rawInput);
  return transaction(async (tx) => {
    const locked = await repo.lockTicket(tx, ctx.workspace.id, id);
    if (!locked) throw Errors.notFound();
    if (!canAgentPost(locked.status, input.internal)) {
      throw Errors.conflict("This request is closed. Only internal notes can be added.");
    }
    return repo.insertMessage(tx, ctx.workspace.id, id, {
      authorType: "agent",
      authorUserId: ctx.user.id,
      body: input.body,
      isInternal: input.internal,
    });
  });
}

/** Everything the inbox needs for its filters: people, categories and per-status counts. */
export async function getInboxOptions(headers: Headers) {
  const ctx = await requireWorkspace(headers, { ticket: ["read"] });
  const [members, settings, counts] = await Promise.all([
    listMembers(ctx.workspace.id),
    getWorkspaceSettings(getDb().db, ctx.workspace.id),
    repo.countTicketsByStatus(ctx.workspace.id),
  ]);
  return {
    assignees: members.map((m) => ({ id: m.userId, name: m.name })),
    categories: settings?.categories ?? [],
    counts,
  };
}

export async function getTicketCounts(headers: Headers) {
  const ctx = await requireWorkspace(headers, { ticket: ["read"] });
  return repo.countTicketsByStatus(ctx.workspace.id);
}

const staleConflict = () =>
  Errors.conflict("This request was changed by someone else. Reload to see the latest version.");

function sqlState(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}
