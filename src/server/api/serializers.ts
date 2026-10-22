import { ingestErrorMessage } from "@/server/modules/kb/ingest-errors";
import type { KbChunkView, KbDocument } from "@/server/modules/kb/repository";
import type { Message, Ticket } from "@/server/modules/tickets/repository";
import type { TriageRun } from "@/server/modules/triage/repository";

/**
 * Explicit mapping from domain rows to API shapes: fields are opted in one by one, so
 * new database columns never leak into responses by accident.
 */
export function apiTicket(t: Ticket, assigneeName?: string | null) {
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    category: t.category,
    customer: { name: t.customerName, email: t.customerEmail },
    assignee: t.assigneeId ? { id: t.assigneeId, name: assigneeName ?? null } : null,
    version: t.version,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    lastActivityAt: t.lastActivityAt,
  };
}

export function apiTriage(r: TriageRun) {
  return {
    status: r.status,
    errorCode: r.errorCode,
    suggestion:
      r.status === "succeeded" && r.category && r.priority && r.sentiment && r.confidence !== null
        ? {
            category: r.category,
            priority: r.priority,
            sentiment: r.sentiment,
            language: r.language,
            confidence: r.confidence,
            reason: r.reason,
          }
        : null,
    applied: { category: r.appliedCategory, priority: r.appliedPriority },
    needsReview: r.needsReview && r.reviewedAt === null,
    reviewedAt: r.reviewedAt,
    overrides: { category: r.categoryOverride, priority: r.priorityOverride },
    flags: r.flags,
    model: r.model,
    promptVersion: r.promptVersion,
    createdAt: r.createdAt,
  };
}

export function apiMessage(m: Message) {
  return {
    id: m.id,
    author: { type: m.authorType, userId: m.authorUserId, name: m.authorName },
    body: m.body,
    internal: m.isInternal,
    createdAt: m.createdAt,
  };
}

export function apiKbDocument(d: KbDocument) {
  return {
    id: d.id,
    title: d.title,
    filename: d.filename,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    status: d.status,
    error:
      d.status === "failed"
        ? { code: d.errorCode ?? "internal_error", message: ingestErrorMessage(d.errorCode) }
        : null,
    pageCount: d.pageCount,
    chunkCount: d.chunkCount,
    tokenEstimate: d.tokenEstimate,
    embeddingModel: d.embeddingModel,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    ingestedAt: d.ingestedAt,
  };
}

export function apiKbChunk(c: KbChunkView) {
  return {
    id: c.id,
    ordinal: c.ordinal,
    headingPath: c.headingPath,
    content: c.content,
    tokenEstimate: c.tokenEstimate,
  };
}
