import type { CitationRow, DraftRow } from "./repository";

/**
 * The draft as the API returns it (schema: `AiDraft` in src/server/api/schemas.ts). The body is
 * untrusted model output: clients must render it as plain text (D9).
 */
export interface ApiDraft {
  id: string;
  ticketId: string;
  status: DraftRow["status"];
  errorCode: string | null;
  body: string;
  language: string | null;
  model: string | null;
  promptVersion: string;
  retrievalTopScore: number | null;
  invalidCitationCount: number;
  warnings: string[];
  citations: {
    marker: number;
    documentId: string | null;
    documentTitle: string;
    headingPath: string;
    content: string;
    similarity: number | null;
    /** The passage or its document was deleted after the draft was written (FR-K3). */
    sourceRemoved: boolean;
  }[];
  usage: { inputTokens: number; outputTokens: number; estCostMicros: number };
  /** The reply this draft became, once an agent approved and sent it. */
  sentMessageId: string | null;
  /** 0 = sent as written, 1 = rewritten. */
  editRatio: number | null;
  feedback: { rating: "up" | "down"; reason: string | null; note: string | null } | null;
  ttftMs: number | null;
  latencyMs: number | null;
  createdAt: string;
}

export function apiDraft(draft: DraftRow, citations: readonly CitationRow[]): ApiDraft {
  return {
    id: draft.id,
    ticketId: draft.ticketId,
    status: draft.status,
    errorCode: draft.errorCode,
    body: draft.body,
    language: draft.language,
    model: draft.model,
    promptVersion: draft.promptVersion,
    retrievalTopScore: draft.retrievalTopScore,
    invalidCitationCount: draft.invalidCitationCount,
    warnings: draft.warnings,
    citations: citations.map((c) => ({
      marker: c.marker,
      documentId: c.documentId,
      documentTitle: c.documentTitle,
      headingPath: c.headingPath,
      content: c.content,
      similarity: c.similarity,
      sourceRemoved: c.chunkId === null,
    })),
    usage: {
      inputTokens: draft.inputTokens,
      outputTokens: draft.outputTokens,
      estCostMicros: draft.estCostMicros,
    },
    sentMessageId: draft.sentMessageId,
    editRatio: draft.editRatio,
    feedback: draft.feedback
      ? { rating: draft.feedback, reason: draft.feedbackReason, note: draft.feedbackNote }
      : null,
    ttftMs: draft.ttftMs,
    latencyMs: draft.latencyMs,
    createdAt: draft.createdAt.toISOString(),
  };
}
