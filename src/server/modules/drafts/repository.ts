import { and, asc, eq } from "drizzle-orm";

import { aiDraft, aiDraftCitation, type AI_DRAFT_STATUSES } from "@/server/platform/db/schema";
import type { Executor } from "@/server/platform/db/tx";

/** Draft storage (M5 D6–D8). Every query filters by `workspaceId` (T1). */

export type DraftStatus = (typeof AI_DRAFT_STATUSES)[number];
export type DraftRow = typeof aiDraft.$inferSelect;
export type CitationRow = typeof aiDraftCitation.$inferSelect;

export async function insertDraft(
  db: Executor,
  workspaceId: string,
  input: { ticketId: string; requestedBy: string; promptVersion: string },
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
