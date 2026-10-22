import { createHash } from "node:crypto";

import { insertAuditEvent, type AuditEvent } from "@/server/platform/auth/audit";
import { requireWorkspace, type WorkspaceContext } from "@/server/platform/auth/context";
import { getDb } from "@/server/platform/db/client";
import { transaction } from "@/server/platform/db/tx";
import { getEnv } from "@/server/platform/env";
import { AppError, Errors } from "@/server/platform/errors";
import { enqueueKbIngest } from "@/server/platform/jobs/boss";
import { logger } from "@/server/platform/logger";
import { consumeRateLimit, rateLimitKey, type RateLimitRule } from "@/server/platform/rate-limit";

import { createEmbedderFromEnv, embeddingCostMicros, type Embedder } from "./embedder";
import { detectFile } from "./file-type";
import { IngestError } from "./ingest-errors";
import { KB_MAX_DOCUMENTS_PER_WORKSPACE, KB_MAX_UPLOAD_BYTES, KB_MAX_WORKSPACE_BYTES } from "./limits";
import * as repo from "./repository";
import {
  fuseRankings,
  RETRIEVAL_CANDIDATES,
  RETRIEVAL_FUSION,
  RETRIEVAL_TOP_K,
  type FusedHit,
} from "./retrieval";
import { kbDocumentId, kbSearchInput } from "./schemas";

/**
 * Knowledge-base use cases (FR-K1–K4). Every function starts with `requireWorkspace`
 * (role read from the database, T2) and passes the caller's workspace to the repository
 * (T1). Unknown and other workspaces' documents are both "not found".
 * Reading needs `kb:read` (every member); changing the knowledge base and test search,
 * which spends embedding quota, need `kb:write` (admins and owners, docs/01 §2.1).
 */

export const KB_RATE_LIMITS = {
  /** Uploads and retries per user per workspace: each one spends embedding quota. */
  uploadsPerUser: { windowSeconds: 3600, max: 30 },
  /** Test searches per user per workspace: each one embeds the question. */
  searchesPerUser: { windowSeconds: 60, max: 30 },
} satisfies Record<string, RateLimitRule>;

/** Interactive search gives up on the AI provider sooner than background ingestion. */
export const KB_SEARCH_EMBED_TIMEOUT_MS = 10_000;

export function kbRateLimitKey(scope: "kb-upload" | "kb-search", ctx: WorkspaceContext): string {
  return rateLimitKey(scope, ctx.workspace.id, ctx.user.id);
}

async function limit(scope: "kb-upload" | "kb-search", ctx: WorkspaceContext, rule: RateLimitRule) {
  const result = await consumeRateLimit(kbRateLimitKey(scope, ctx), rule);
  if (!result.allowed) {
    logger.warn({ event: "kb.rate_limited", scope, workspaceId: ctx.workspace.id }, "kb rate limit hit");
    throw Errors.tooManyRequests(result.retryAfterSeconds);
  }
}

function documentEvent(
  ctx: WorkspaceContext,
  doc: repo.KbDocument,
  action: Extract<AuditEvent["action"], `kb.${string}`>,
  metadata: AuditEvent["metadata"] = {},
): AuditEvent {
  return {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action,
    targetType: "kb_document",
    targetId: doc.id,
    // The title of a help article: shown in the audit log, because the document itself may be gone.
    metadata: { title: doc.title, ...metadata },
  };
}

function parseDocumentId(raw: string): string {
  const parsed = kbDocumentId.safeParse(raw);
  if (!parsed.success) throw Errors.notFound();
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Reading (every member)
// ---------------------------------------------------------------------------

export async function listKbDocuments(headers: Headers) {
  const ctx = await requireWorkspace(headers, { kb: ["read"] });
  const [items, usage] = await Promise.all([
    repo.listDocuments(ctx.workspace.id),
    repo.getWorkspaceKbUsage(getDb().db, ctx.workspace.id),
  ]);
  return {
    items,
    usage: { ...usage, maxDocuments: KB_MAX_DOCUMENTS_PER_WORKSPACE, maxBytes: KB_MAX_WORKSPACE_BYTES },
  };
}

export async function getKbDocument(headers: Headers, rawId: string) {
  const ctx = await requireWorkspace(headers, { kb: ["read"] });
  const id = parseDocumentId(rawId);
  const document = await repo.findDocument(ctx.workspace.id, id);
  if (!document) throw Errors.notFound();
  return { document, chunks: await repo.listChunks(ctx.workspace.id, id) };
}

// ---------------------------------------------------------------------------
// Changing the knowledge base (admins and owners)
// ---------------------------------------------------------------------------

function invalidFile(err: IngestError): AppError {
  if (err.code === "file_too_large") return Errors.fileTooLarge(KB_MAX_UPLOAD_BYTES);
  return new AppError(400, "invalid_file", "Invalid File", err.message, { file: [err.message] }, undefined, {
    reason: err.code,
  });
}

/**
 * FR-K1. Validates the file (OWASP File Upload Cheat Sheet: allowlisted extension plus a
 * content check; the browser's Content-Type is never read), then stores it and queues
 * ingestion in one transaction. Duplicates and full workspaces are refused with 409.
 */
export async function uploadKbDocument(headers: Headers, file: { name: string; bytes: Buffer }) {
  const ctx = await requireWorkspace(headers, { kb: ["write"] });
  await limit("kb-upload", ctx, KB_RATE_LIMITS.uploadsPerUser);

  let detected: ReturnType<typeof detectFile>;
  try {
    detected = detectFile(file.name, file.bytes);
  } catch (err) {
    if (err instanceof IngestError) throw invalidFile(err);
    throw err;
  }
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const ws = ctx.workspace.id;

  const doc = await transaction(async (tx) => {
    // One upload at a time per workspace, so parallel uploads can't both pass the caps.
    await repo.lockWorkspaceUploads(tx, ws);
    const existing = await repo.findDocumentBySha256(tx, ws, sha256);
    if (existing) {
      throw Errors.conflict(
        `This file is already in the knowledge base as “${existing.title}”.`,
        "duplicate_document",
        {
          existingDocumentId: existing.id,
        },
      );
    }
    const usage = await repo.getWorkspaceKbUsage(tx, ws);
    if (usage.documentCount >= KB_MAX_DOCUMENTS_PER_WORKSPACE) {
      throw Errors.conflict(
        `The knowledge base is full (${KB_MAX_DOCUMENTS_PER_WORKSPACE} documents). Delete a document first.`,
        "kb_quota_exceeded",
      );
    }
    if (usage.totalBytes + file.bytes.byteLength > KB_MAX_WORKSPACE_BYTES) {
      throw Errors.conflict(
        `The knowledge base is full (${KB_MAX_WORKSPACE_BYTES / 1024 / 1024} MB stored). Delete a document first.`,
        "kb_quota_exceeded",
      );
    }
    const created = await repo.insertDocument(tx, ws, {
      title: detected.title,
      filename: detected.filename,
      mimeType: detected.mimeType,
      sha256,
      uploadedBy: ctx.user.id,
      bytes: file.bytes,
    });
    await enqueueKbIngest(tx, { workspaceId: ws, documentId: created.id });
    await insertAuditEvent(
      tx,
      documentEvent(ctx, created, "kb.document_uploaded", {
        mimeType: created.mimeType,
        sizeBytes: created.sizeBytes,
      }),
    );
    return created;
  });
  logger.info(
    {
      event: "kb.document_uploaded",
      workspaceId: ws,
      documentId: doc.id,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
    },
    "kb document uploaded",
  );
  return doc;
}

/** FR-K3. Chunks and the stored file go with it (ON DELETE CASCADE), so search stops finding it at once. */
export async function deleteKbDocument(headers: Headers, rawId: string): Promise<void> {
  const ctx = await requireWorkspace(headers, { kb: ["write"] });
  const id = parseDocumentId(rawId);
  const deleted = await transaction(async (tx) => {
    // If ingestion is running, this waits for its row lock, and the job then finds nothing to save.
    const doc = await repo.deleteDocument(tx, ctx.workspace.id, id);
    if (!doc) throw Errors.notFound();
    await insertAuditEvent(tx, documentEvent(ctx, doc, "kb.document_deleted", { status: doc.status }));
    return doc;
  });
  logger.info(
    { event: "kb.document_deleted", workspaceId: ctx.workspace.id, documentId: deleted.id },
    "kb document deleted",
  );
}

/** A failed document goes back to `pending` and is queued again (its file is kept after a failure). */
export async function retryKbDocument(headers: Headers, rawId: string) {
  const ctx = await requireWorkspace(headers, { kb: ["write"] });
  const id = parseDocumentId(rawId);
  await limit("kb-upload", ctx, KB_RATE_LIMITS.uploadsPerUser);
  const ws = ctx.workspace.id;
  const doc = await transaction(async (tx) => {
    const current = await repo.findDocument(ws, id);
    if (!current) throw Errors.notFound();
    const previousError = current.errorCode;
    const reset = await repo.resetForRetry(tx, ws, id);
    if (!reset) {
      throw Errors.conflict(
        current.status === "failed"
          ? "The original file is no longer stored. Upload it again."
          : `Only failed documents can be retried (this one is ${current.status}).`,
        "not_retryable",
      );
    }
    await enqueueKbIngest(tx, { workspaceId: ws, documentId: id });
    await insertAuditEvent(tx, documentEvent(ctx, reset, "kb.document_retried", { previousError }));
    return reset;
  });
  logger.info({ event: "kb.document_retried", workspaceId: ws, documentId: id }, "kb document retried");
  return doc;
}

// ---------------------------------------------------------------------------
// Retrieval (FR-K4 test search; M5 drafts will call hybridSearch directly)
// ---------------------------------------------------------------------------

export interface KbSearchResult extends FusedHit {
  rank: number;
  chunk: repo.KbChunkView;
  document: { id: string; title: string };
}

export interface KbSearchResponse {
  query: string;
  model: string | null;
  results: KbSearchResult[];
  timingsMs: { embedding: number; retrieval: number };
}

const globalForEmbedder = globalThis as unknown as { __spSearchEmbedder?: Embedder };

function webEmbedder(): Embedder {
  globalForEmbedder.__spSearchEmbedder ??= createEmbedderFromEnv(getEnv());
  return globalForEmbedder.__spSearchEmbedder;
}

function searchEmbeddingError(err: unknown): unknown {
  if (!(err instanceof IngestError)) return err;
  if (err.code === "embedding_unavailable") {
    return Errors.serviceUnavailable("The AI provider is unavailable. Try again shortly.", 30);
  }
  return Errors.badGateway("The AI provider rejected the request. Check the AI configuration.");
}

const elapsed = (start: number) => Math.round((performance.now() - start) * 10) / 10;

/**
 * Hybrid retrieval (D10) over the workspace's ready documents: vector top 8 + keyword
 * top 8, fused with RRF, best 5. A workspace with no ready documents returns no results
 * without calling the AI provider. Documents embedded with another model are refused (D4).
 */
export async function hybridSearch(
  workspaceId: string,
  query: string,
  embedder: Embedder,
  {
    topK = RETRIEVAL_TOP_K,
    candidates = RETRIEVAL_CANDIDATES,
    embedTimeoutMs = KB_SEARCH_EMBED_TIMEOUT_MS,
  } = {},
): Promise<KbSearchResponse> {
  const models = await repo.listWorkspaceEmbeddingModels(workspaceId);
  if (models.length === 0)
    return { query, model: null, results: [], timingsMs: { embedding: 0, retrieval: 0 } };
  if (models.length > 1 || models[0] !== embedder.modelId) {
    throw Errors.conflict(
      `Documents were embedded with ${models.join(", ")}, but search uses ${embedder.modelId}. ` +
        "Re-embed the knowledge base before searching.",
      "embedding_model_mismatch",
    );
  }

  const embedStart = performance.now();
  let queryEmbedding: Awaited<ReturnType<Embedder["embedQuery"]>>;
  try {
    queryEmbedding = await embedder.embedQuery(query, AbortSignal.timeout(embedTimeoutMs));
  } catch (err) {
    throw searchEmbeddingError(err);
  }
  const embedding = elapsed(embedStart);

  const retrievalStart = performance.now();
  const { fused, chunks } = await transaction(async (tx) => {
    await repo.insertAiUsage(tx, workspaceId, {
      feature: "embed",
      model: embedder.modelId,
      inputTokens: queryEmbedding.tokenEstimate,
      estCostMicros: embeddingCostMicros(embedder.modelId, queryEmbedding.tokenEstimate),
    });
    const vectorHits = await repo.vectorSearch(tx, workspaceId, queryEmbedding.embedding, candidates);
    const keywordHits = await repo.keywordSearch(tx, workspaceId, query, candidates);
    const fusedHits = fuseRankings(vectorHits, keywordHits, { ...RETRIEVAL_FUSION, topK });
    return {
      fused: fusedHits,
      chunks: await repo.findChunksForDisplay(
        tx,
        workspaceId,
        fusedHits.map((h) => h.chunkId),
      ),
    };
  });
  const retrieval = elapsed(retrievalStart);

  const byId = new Map(chunks.map((c) => [c.id, c]));
  // A document deleted between the queries drops out; ranks are renumbered.
  const results = fused
    .filter((hit) => byId.has(hit.chunkId))
    .map((hit, i) => {
      const { documentTitle, ...chunk } = byId.get(hit.chunkId)!;
      return { ...hit, rank: i + 1, chunk, document: { id: chunk.documentId, title: documentTitle } };
    });
  return { query, model: embedder.modelId, results, timingsMs: { embedding, retrieval } };
}

/** FR-K4: the admin "test search" box. */
export async function searchKnowledgeBase(
  headers: Headers,
  rawInput: unknown,
  deps: { embedder?: Embedder; embedTimeoutMs?: number } = {},
) {
  const ctx = await requireWorkspace(headers, { kb: ["write"] });
  const input = kbSearchInput.parse(rawInput);
  await limit("kb-search", ctx, KB_RATE_LIMITS.searchesPerUser);
  const response = await hybridSearch(ctx.workspace.id, input.query, deps.embedder ?? webEmbedder(), {
    ...(deps.embedTimeoutMs ? { embedTimeoutMs: deps.embedTimeoutMs } : {}),
  });
  logger.info(
    {
      event: "kb.search",
      workspaceId: ctx.workspace.id,
      results: response.results.length,
      embeddingMs: response.timingsMs.embedding,
      retrievalMs: response.timingsMs.retrieval,
    },
    "kb test search",
  );
  return response;
}
