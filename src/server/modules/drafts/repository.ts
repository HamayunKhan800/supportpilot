import { and, asc, desc, eq } from "drizzle-orm";

import {
  aiDraft,
  aiDraftCitation,
  type AI_DRAFT_STATUSES,
  type DRAFT_FEEDBACK,
  type DRAFT_FEEDBACK_REASONS,
} from "@/server/platform/db/schema";
import type { Executor, Transaction } from "@/server/platform/db/tx";

/** Draft storage (M5 D6–D8). Every query filters by `workspaceId` (T1). */

export type DraftStatus = (typeof AI_DRAFT_STATUSES)[number];
export type DraftRow = typeof aiDraft.$inferSelect;
export type CitationRow = typeof aiDraftCitation.$inferSelect;

export async function insertDraft(
  db: Executor,
  workspaceId: string,
  input: { ticketId: string; requestedBy: string | null; promptVersion: string },
): Promise<string> {
  const [row] = await db
    .insert(aiDraft)
    .values({ workspaceId, ...input, status: "generating" })
    .returning({ id: aiDraft.id });
  return row!.id;
}

export interface DraftOutcome {
  status: Exclude<DraftStatus, "generating" | "sent" | "discarded">;
  errorCode?: string | null;
  body?: string;
  language?: string | null;
  model?: string | null;
  retrievalTopScore?: number | null;
  invalidCitationCount?: number;
  warnings?: string[];
  inputTokens?: number;
  outputTokens?: number;
  estCostMicros?: number;
  ttftMs?: number | null;
  latencyMs?: number | null;
}

/** Records how a generation ended. Only a draft still `generating` can be finished. */
export async function finishDraft(
  db: Executor,
  workspaceId: string,
  draftId: string,
  outcome: DraftOutcome,
): Promise<boolean> {
  const rows = await db
    .update(aiDraft)
    .set({ ...outcome, updatedAt: new Date() })
    .where(
      and(eq(aiDraft.workspaceId, workspaceId), eq(aiDraft.id, draftId), eq(aiDraft.status, "generating")),
    )
    .returning({ id: aiDraft.id });
  return rows.length === 1;
}

export interface NewCitation {
  marker: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  headingPath: string;
  content: string;
  similarity: number | null;
}

export async function insertCitations(
  db: Executor,
  workspaceId: string,
  draftId: string,
  citations: readonly NewCitation[],
): Promise<void> {
  if (citations.length === 0) return;
  await db.insert(aiDraftCitation).values(citations.map((c) => ({ workspaceId, draftId, ...c })));
}

export async function findDraft(
  db: Executor,
  workspaceId: string,
  draftId: string,
): Promise<{ draft: DraftRow; citations: CitationRow[] } | null> {
  const [draft] = await db
    .select()
    .from(aiDraft)
    .where(and(eq(aiDraft.workspaceId, workspaceId), eq(aiDraft.id, draftId)));
  if (!draft) return null;
  const citations = await db
    .select()
    .from(aiDraftCitation)
    .where(and(eq(aiDraftCitation.workspaceId, workspaceId), eq(aiDraftCitation.draftId, draftId)))
    .orderBy(asc(aiDraftCitation.marker));
  return { draft, citations };
}

/** Locks the draft for a send or discard, so two agents can't both act on it. */
export async function lockDraft(tx: Transaction, workspaceId: string, draftId: string) {
  const [row] = await tx
    .select({ id: aiDraft.id, ticketId: aiDraft.ticketId, status: aiDraft.status, body: aiDraft.body })
    .from(aiDraft)
    .where(and(eq(aiDraft.workspaceId, workspaceId), eq(aiDraft.id, draftId)))
    .for("update");
  return row ?? null;
}

export async function markSent(
  tx: Executor,
  workspaceId: string,
  draftId: string,
  input: { sentMessageId: string; editRatio: number },
): Promise<void> {
  await tx
    .update(aiDraft)
    .set({ status: "sent", ...input, updatedAt: new Date() })
    .where(and(eq(aiDraft.workspaceId, workspaceId), eq(aiDraft.id, draftId)));
}

export async function markDiscarded(tx: Executor, workspaceId: string, draftId: string): Promise<void> {
  await tx
    .update(aiDraft)
    .set({ status: "discarded", updatedAt: new Date() })
    .where(and(eq(aiDraft.workspaceId, workspaceId), eq(aiDraft.id, draftId)));
}

export interface DraftFeedback {
  rating: (typeof DRAFT_FEEDBACK)[number];
  reason: (typeof DRAFT_FEEDBACK_REASONS)[number] | null;
  note: string | null;
}

/** Sets (or replaces) feedback. Not for drafts still being written. Returns false if none matched. */
export async function setFeedback(
  db: Executor,
  workspaceId: string,
  draftId: string,
  userId: string,
  feedback: DraftFeedback,
): Promise<"ok" | "missing" | "generating"> {
  const [row] = await db
    .select({ status: aiDraft.status })
    .from(aiDraft)
    .where(and(eq(aiDraft.workspaceId, workspaceId), eq(aiDraft.id, draftId)));
  if (!row) return "missing";
  if (row.status === "generating") return "generating";
  await db
    .update(aiDraft)
    .set({
      feedback: feedback.rating,
      feedbackReason: feedback.rating === "down" ? feedback.reason : null,
      feedbackNote: feedback.note,
      feedbackBy: userId,
      feedbackAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(aiDraft.workspaceId, workspaceId), eq(aiDraft.id, draftId)));
  return "ok";
}

/** The newest draft of a ticket that is ready and not yet sent or discarded (survives a reload). */
export async function findOpenDraftId(db: Executor, workspaceId: string, ticketId: string) {
  const [row] = await db
    .select({ id: aiDraft.id, status: aiDraft.status })
    .from(aiDraft)
    .where(and(eq(aiDraft.workspaceId, workspaceId), eq(aiDraft.ticketId, ticketId)))
    .orderBy(desc(aiDraft.createdAt), desc(aiDraft.id))
    .limit(1);
  return row?.status === "ready" ? row.id : null;
}
