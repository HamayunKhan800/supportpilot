import { z } from "zod";

import { canAgentPost } from "@/server/modules/tickets/lifecycle";
import * as ticketRepo from "@/server/modules/tickets/repository";
import { insertAuditEvent } from "@/server/platform/auth/audit";
import { requireWorkspace } from "@/server/platform/auth/context";
import { getDb } from "@/server/platform/db/client";
import { transaction } from "@/server/platform/db/tx";
import { Errors } from "@/server/platform/errors";

import { customerCopy, editRatio } from "./citations";
import * as repo from "./repository";
import { draftFeedbackInput, draftSendInput } from "./schemas";
import { apiDraft, type ApiDraft } from "./serialize";

/**
 * What agents do with a draft (M5 FR-AI5, FR-AI6): send it as their own reply, discard it, or
 * rate it. Nothing AI-written reaches a customer except through `sendDraft`, which needs an
 * agent's explicit request (ADR-0009).
 */

const parseId = (raw: string) => {
  const r = z.uuid().safeParse(raw);
  if (!r.success) throw Errors.notFound();
  return r.data;
};

async function load(workspaceId: string, draftId: string): Promise<ApiDraft> {
  const found = await repo.findDraft(getDb().db, workspaceId, draftId);
  if (!found) throw Errors.notFound();
  return apiDraft(found.draft, found.citations);
}

const notOpen = (status: string) =>
  Errors.conflict(
    status === "sent"
      ? "This draft was already sent."
      : status === "discarded"
        ? "This draft was discarded. Generate a new one."
        : "Only a finished draft can be sent or discarded.",
    "draft_not_open",
  );

/** Posts the edited draft as the agent's public reply and records how much they changed it. */
export async function sendDraft(headers: Headers, rawId: string, rawInput: unknown): Promise<ApiDraft> {
  const ctx = await requireWorkspace(headers, { draft: ["approve"], ticket: ["update"] });
  const draftId = parseId(rawId);
  const input = draftSendInput.parse(rawInput);
  const body = customerCopy(input.body);
  if (!body) throw Errors.badRequest("The reply is empty.", { body: ["Write a reply before sending."] });

  const ws = ctx.workspace.id;
  await transaction(async (tx) => {
    const draft = await repo.lockDraft(tx, ws, draftId);
    if (!draft) throw Errors.notFound();
    if (draft.status !== "ready") throw notOpen(draft.status);
    const ticket = await ticketRepo.lockTicket(tx, ws, draft.ticketId);
    if (!ticket) throw Errors.notFound();
    if (!canAgentPost(ticket.status, false)) {
      throw Errors.conflict("This request is closed, so the reply can't be sent.", "ticket_closed");
    }
    const message = await ticketRepo.insertMessage(tx, ws, draft.ticketId, {
      authorType: "agent",
      authorUserId: ctx.user.id,
      body,
      isInternal: false,
    });
    const ratio = editRatio(draft.body, body);
    await repo.markSent(tx, ws, draftId, { sentMessageId: message.id, editRatio: ratio });
    // Who approved AI-written text, and how much they changed it (no message text: FR-T6).
    await insertAuditEvent(tx, {
      workspaceId: ws,
      actorUserId: ctx.user.id,
      action: "ticket.ai_reply_sent",
      targetType: "ticket",
      targetId: draft.ticketId,
      metadata: { draftId, messageId: message.id, editRatio: ratio },
    });
  });
  return load(ws, draftId);
}

export async function discardDraft(headers: Headers, rawId: string): Promise<ApiDraft> {
  const ctx = await requireWorkspace(headers, { draft: ["generate"] });
  const draftId = parseId(rawId);
  await transaction(async (tx) => {
    const draft = await repo.lockDraft(tx, ctx.workspace.id, draftId);
    if (!draft) throw Errors.notFound();
    if (draft.status !== "ready") throw notOpen(draft.status);
    await repo.markDiscarded(tx, ctx.workspace.id, draftId);
  });
  return load(ctx.workspace.id, draftId);
}

/** Helpful / not helpful, with an optional reason and note; a second rating replaces the first. */
export async function rateDraft(headers: Headers, rawId: string, rawInput: unknown): Promise<ApiDraft> {
  const ctx = await requireWorkspace(headers, { draft: ["generate"] });
  const draftId = parseId(rawId);
  const input = draftFeedbackInput.parse(rawInput);
  const result = await repo.setFeedback(getDb().db, ctx.workspace.id, draftId, ctx.user.id, {
    rating: input.rating,
    reason: input.rating === "down" ? (input.reason ?? null) : null,
    note: input.note || null,
  });
  if (result === "missing") throw Errors.notFound();
  if (result === "generating") throw Errors.conflict("Wait until the draft is finished.", "draft_not_open");
  return load(ctx.workspace.id, draftId);
}

/** The ticket's unsent draft, if any, so a reload doesn't lose it. For the ticket page. */
export async function getOpenDraft(headers: Headers, ticketId: string): Promise<ApiDraft | null> {
  const ctx = await requireWorkspace(headers, { draft: ["generate"] });
  const id = await repo.findOpenDraftId(getDb().db, ctx.workspace.id, ticketId);
  return id ? load(ctx.workspace.id, id) : null;
}
