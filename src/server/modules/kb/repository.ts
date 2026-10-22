import { and, asc, count, desc, eq, inArray, isNotNull, sql, sum } from "drizzle-orm";
import { getDb } from "@/server/platform/db/client";
import {
  aiUsage,
  kbChunk,
  kbDocument,
  kbDocumentBlob,
  type AI_USAGE_FEATURES,
  type KB_DOCUMENT_STATUSES,
  type KbMimeType,
} from "@/server/platform/db/schema";
import type { Executor, Transaction } from "@/server/platform/db/tx";

/**
 * Knowledge-base data access. Every function takes `workspaceId` and filters by it
 * (tenant isolation, T1), including the worker-side functions: a job names both the
 * workspace and the document, and a mismatch finds nothing.
 * Write functions take an executor so services can group writes in one transaction.
 */

export type KbDocumentStatus = (typeof KB_DOCUMENT_STATUSES)[number];
export type { KbMimeType };
export type AiUsageFeature = (typeof AI_USAGE_FEATURES)[number];

export type KbDocument = typeof kbDocument.$inferSelect;

/** A chunk as shown to people: never the embedding or the search vector. */
export interface KbChunkView {
  id: string;
  documentId: string;
  ordinal: number;
  headingPath: string;
  content: string;
  tokenEstimate: number;
}

const chunkViewColumns = {
  id: kbChunk.id,
  documentId: kbChunk.documentId,
  ordinal: kbChunk.ordinal,
  headingPath: kbChunk.headingPath,
  content: kbChunk.content,
  tokenEstimate: kbChunk.tokenEstimate,
};

const inWorkspace = (workspaceId: string, id: string) =>
  and(eq(kbDocument.workspaceId, workspaceId), eq(kbDocument.id, id));

// ---------------------------------------------------------------------------
// Upload side (web process)
// ---------------------------------------------------------------------------

export interface NewKbDocument {
  title: string;
  filename: string;
  mimeType: KbMimeType;
  sha256: string;
  uploadedBy: string | null;
  bytes: Buffer;
}

/** Inserts the document (status `pending`) and its blob. */
export async function insertDocument(
  tx: Executor,
  workspaceId: string,
  input: NewKbDocument,
): Promise<KbDocument> {
  const [doc] = await tx
    .insert(kbDocument)
    .values({
      workspaceId,
      title: input.title,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      sha256: input.sha256,
      uploadedBy: input.uploadedBy,
    })
    .returning();
  await tx.insert(kbDocumentBlob).values({ documentId: doc!.id, bytes: input.bytes });
  return doc!;
}

export async function findDocumentBySha256(
  tx: Executor,
  workspaceId: string,
  sha256: string,
): Promise<KbDocument | null> {
  const [doc] = await tx
    .select()
    .from(kbDocument)
    .where(and(eq(kbDocument.workspaceId, workspaceId), eq(kbDocument.sha256, sha256)))
    .limit(1);
  return doc ?? null;
}

/** Document count and stored bytes, for the per-workspace caps (D7). */
export async function getWorkspaceKbUsage(
  tx: Executor,
  workspaceId: string,
): Promise<{ documentCount: number; totalBytes: number }> {
  const [row] = await tx
    .select({ documentCount: count(), totalBytes: sum(kbDocument.sizeBytes) })
    .from(kbDocument)
    .where(eq(kbDocument.workspaceId, workspaceId));
  return { documentCount: row?.documentCount ?? 0, totalBytes: Number(row?.totalBytes ?? 0) };
}

/**
 * Serializes uploads per workspace for the rest of the transaction, so two parallel
 * uploads can't both pass the cap check (D7).
 */
export async function lockWorkspaceUploads(tx: Transaction, workspaceId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`kb_upload:${workspaceId}`}, 0))`);
}

/** Newest first. Workspaces hold at most 100 documents (D7), so there is no paging. */
export async function listDocuments(workspaceId: string): Promise<KbDocument[]> {
  return getDb()
    .db.select()
    .from(kbDocument)
    .where(eq(kbDocument.workspaceId, workspaceId))
    .orderBy(desc(kbDocument.createdAt), desc(kbDocument.id));
}

export async function findDocument(workspaceId: string, id: string): Promise<KbDocument | null> {
  const [doc] = await getDb().db.select().from(kbDocument).where(inWorkspace(workspaceId, id)).limit(1);
  return doc ?? null;
}

export async function listChunks(workspaceId: string, documentId: string): Promise<KbChunkView[]> {
  return getDb()
    .db.select(chunkViewColumns)
    .from(kbChunk)
    .where(and(eq(kbChunk.workspaceId, workspaceId), eq(kbChunk.documentId, documentId)))
    .orderBy(asc(kbChunk.ordinal));
}

/** Deletes the document; its chunks and blob go with it (ON DELETE CASCADE). */
export async function deleteDocument(
  tx: Executor,
  workspaceId: string,
  id: string,
): Promise<KbDocument | null> {
  const [doc] = await tx.delete(kbDocument).where(inWorkspace(workspaceId, id)).returning();
  return doc ?? null;
}

/**
 * Failed → pending, only while the blob still exists (it is deleted on success).
 * Returns the updated document, or null if it can't be retried.
 */
export async function resetForRetry(
  tx: Executor,
  workspaceId: string,
  id: string,
): Promise<KbDocument | null> {
  const [doc] = await tx
    .update(kbDocument)
    .set({ status: "pending", errorCode: null, updatedAt: sql`now()` })
    .where(
      and(
        inWorkspace(workspaceId, id),
        eq(kbDocument.status, "failed"),
        sql`EXISTS (SELECT 1 FROM ${kbDocumentBlob} WHERE ${kbDocumentBlob.documentId} = ${kbDocument.id})`,
      ),
    )
    .returning();
  return doc ?? null;
}

/** Embedding models used by this workspace's ready documents (D4: must be exactly one). */
export async function listWorkspaceEmbeddingModels(workspaceId: string): Promise<string[]> {
  const rows = await getDb()
    .db.selectDistinct({ model: kbDocument.embeddingModel })
    .from(kbDocument)
    .where(
      and(
        eq(kbDocument.workspaceId, workspaceId),
        eq(kbDocument.status, "ready"),
        isNotNull(kbDocument.embeddingModel),
      ),
    );
  return rows.map((r) => r.model!).sort();
}

// ---------------------------------------------------------------------------
// Ingestion side (worker process)
// ---------------------------------------------------------------------------

/**
 * Locks the document row for the rest of the transaction. A concurrent delete waits for
 * this transaction (and vice versa), so chunks are never written for a deleted document.
 */
export async function lockDocument(
  tx: Transaction,
  workspaceId: string,
  id: string,
): Promise<KbDocument | null> {
  const [doc] = await tx.select().from(kbDocument).where(inWorkspace(workspaceId, id)).for("update");
  return doc ?? null;
}

/** pending (or processing, after a crashed attempt) → processing. */
export async function markProcessing(tx: Executor, workspaceId: string, id: string): Promise<boolean> {
  const rows = await tx
    .update(kbDocument)
    .set({ status: "processing", errorCode: null, updatedAt: sql`now()` })
    .where(and(inWorkspace(workspaceId, id), inArray(kbDocument.status, ["pending", "processing"])))
    .returning({ id: kbDocument.id });
  return rows.length === 1;
}

export async function readBlob(tx: Executor, workspaceId: string, id: string): Promise<Buffer | null> {
  const [row] = await tx
    .select({ bytes: kbDocumentBlob.bytes })
    .from(kbDocumentBlob)
    .innerJoin(kbDocument, eq(kbDocument.id, kbDocumentBlob.documentId))
    .where(inWorkspace(workspaceId, id))
    .limit(1);
  return row?.bytes ?? null;
}

export interface NewKbChunk {
  headingPath: string;
  content: string;
  tokenEstimate: number;
  embedding: number[];
}

const CHUNK_INSERT_BATCH = 100;

/** Replaces all chunks of a document (idempotent re-ingestion, D9). Call inside a transaction. */
export async function replaceChunks(
  tx: Transaction,
  workspaceId: string,
  documentId: string,
  chunks: NewKbChunk[],
): Promise<void> {
  await tx
    .delete(kbChunk)
    .where(and(eq(kbChunk.workspaceId, workspaceId), eq(kbChunk.documentId, documentId)));
  for (let i = 0; i < chunks.length; i += CHUNK_INSERT_BATCH) {
    await tx.insert(kbChunk).values(
      chunks.slice(i, i + CHUNK_INSERT_BATCH).map((c, j) => ({
        workspaceId,
        documentId,
        ordinal: i + j,
        headingPath: c.headingPath,
        content: c.content,
        tokenEstimate: c.tokenEstimate,
        embedding: c.embedding,
      })),
    );
  }
}

/** processing → ready, and deletes the blob (ADR-0002). */
export async function markReady(
  tx: Executor,
  workspaceId: string,
  id: string,
  result: { chunkCount: number; tokenEstimate: number; pageCount: number | null; embeddingModel: string },
): Promise<boolean> {
  const rows = await tx
    .update(kbDocument)
    .set({
      status: "ready",
      errorCode: null,
      chunkCount: result.chunkCount,
      tokenEstimate: result.tokenEstimate,
      pageCount: result.pageCount,
      embeddingModel: result.embeddingModel,
      ingestedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(inWorkspace(workspaceId, id), eq(kbDocument.status, "processing")))
    .returning({ id: kbDocument.id });
  if (rows.length !== 1) return false;
  await tx.delete(kbDocumentBlob).where(eq(kbDocumentBlob.documentId, id));
  return true;
}

/**
 * pending/processing → failed with a reason, and removes any chunks left from an earlier
 * run. The blob is kept so the document can be retried.
 */
export async function markFailed(
  tx: Executor,
  workspaceId: string,
  id: string,
  errorCode: string,
  pageCount: number | null = null,
): Promise<boolean> {
  const rows = await tx
    .update(kbDocument)
    .set({ status: "failed", errorCode, pageCount, chunkCount: 0, updatedAt: sql`now()` })
    .where(and(inWorkspace(workspaceId, id), inArray(kbDocument.status, ["pending", "processing"])))
    .returning({ id: kbDocument.id });
  if (rows.length !== 1) return false;
  await tx.delete(kbChunk).where(and(eq(kbChunk.workspaceId, workspaceId), eq(kbChunk.documentId, id)));
  return true;
}

// ---------------------------------------------------------------------------
// Re-embedding (D4: `pnpm kb:reembed`)
// ---------------------------------------------------------------------------

/** Ready documents of a workspace embedded with any model other than `modelId`. */
export async function listDocumentsToReembed(workspaceId: string, modelId: string): Promise<KbDocument[]> {
  return getDb()
    .db.select()
    .from(kbDocument)
    .where(
      and(
        eq(kbDocument.workspaceId, workspaceId),
        eq(kbDocument.status, "ready"),
        sql`${kbDocument.embeddingModel} IS DISTINCT FROM ${modelId}`,
      ),
    )
    .orderBy(asc(kbDocument.createdAt), asc(kbDocument.id));
}

/** The stored passages of a document, in order: what gets embedded again. */
export async function listChunkTexts(
  tx: Executor,
  workspaceId: string,
  documentId: string,
): Promise<{ id: string; headingPath: string; content: string }[]> {
  return tx
    .select({ id: kbChunk.id, headingPath: kbChunk.headingPath, content: kbChunk.content })
    .from(kbChunk)
    .where(and(eq(kbChunk.workspaceId, workspaceId), eq(kbChunk.documentId, documentId)))
    .orderBy(asc(kbChunk.ordinal));
}

/**
 * Swaps in new vectors for existing chunks and records the new model on the document.
 * Call inside a transaction, with the document locked and still `ready`.
 */
export async function replaceEmbeddings(
  tx: Transaction,
  workspaceId: string,
  documentId: string,
  embeddingModel: string,
  vectors: { id: string; embedding: number[] }[],
): Promise<void> {
  for (const v of vectors) {
    await tx
      .update(kbChunk)
      .set({ embedding: v.embedding })
      .where(
        and(eq(kbChunk.workspaceId, workspaceId), eq(kbChunk.documentId, documentId), eq(kbChunk.id, v.id)),
      );
  }
  await tx
    .update(kbDocument)
    .set({ embeddingModel, updatedAt: sql`now()` })
    .where(and(inWorkspace(workspaceId, documentId), eq(kbDocument.status, "ready")));
}

// ---------------------------------------------------------------------------
// AI usage
// ---------------------------------------------------------------------------

export async function insertAiUsage(
  tx: Executor,
  workspaceId: string,
  input: {
    feature: AiUsageFeature;
    model: string;
    inputTokens: number;
    outputTokens?: number;
    estCostMicros: number;
  },
): Promise<void> {
  await tx.insert(aiUsage).values({
    workspaceId,
    feature: input.feature,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens ?? 0,
    estCostMicros: input.estCostMicros,
  });
}

// ---------------------------------------------------------------------------
// Retrieval (D10)
// ---------------------------------------------------------------------------

/**
 * Nearest chunks by cosine distance. One HNSW index serves all workspaces and pgvector
 * filters *after* scanning it, so iterative scans keep going until `limit` chunks of this
 * workspace are found. Relaxed order gives better recall; the materialized CTE restores
 * exact order (`+ 0` is needed on PostgreSQL 17+, per pgvector's README).
 * Must run inside a transaction: the settings are `SET LOCAL`.
 */
export async function vectorSearch(
  tx: Transaction,
  workspaceId: string,
  embedding: number[],
  limit: number,
): Promise<{ chunkId: string; similarity: number }[]> {
  await tx.execute(sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
  const query = JSON.stringify(embedding);
  const result = await tx.execute<{ id: string; distance: number }>(sql`
    WITH nearest AS MATERIALIZED (
      SELECT c.id, c.embedding <=> ${query}::vector AS distance
      FROM ${kbChunk} c
      WHERE c.workspace_id = ${workspaceId}
        AND EXISTS (
          SELECT 1 FROM ${kbDocument} d
          WHERE d.id = c.document_id AND d.workspace_id = c.workspace_id AND d.status = 'ready'
        )
      ORDER BY distance
      LIMIT ${limit}
    )
    SELECT id, distance FROM nearest ORDER BY distance + 0, id`);
  return result.rows.map((r) => ({ chunkId: r.id, similarity: 1 - Number(r.distance) }));
}

/**
 * Keyword matches with English stemming (D11), for **questions**, so any word may match:
 * `plainto_tsquery` joins words with AND (PostgreSQL docs §12.3.2), and a question like
 * "How long do refunds take?" would then need "long", "refund" and "take" in one passage.
 * Its AND operators are turned into OR; ts_rank_cd still ranks passages that match more
 * words higher. plainto_tsquery treats every operator character in the input as text, so
 * user input can't inject query syntax. A query of only stop words matches nothing.
 */
export async function keywordSearch(
  tx: Executor,
  workspaceId: string,
  text: string,
  limit: number,
): Promise<{ chunkId: string; score: number }[]> {
  const result = await tx.execute<{ id: string; score: number }>(sql`
    SELECT c.id, ts_rank_cd(c.tsv, q.query) AS score
    FROM ${kbChunk} c,
      (SELECT replace(plainto_tsquery('english', ${text})::text, ' & ', ' | ')::tsquery AS query) q
    WHERE c.workspace_id = ${workspaceId}
      AND c.tsv @@ q.query
      AND EXISTS (
        SELECT 1 FROM ${kbDocument} d
        WHERE d.id = c.document_id AND d.workspace_id = c.workspace_id AND d.status = 'ready'
      )
    ORDER BY score DESC, c.id
    LIMIT ${limit}`);
  return result.rows.map((r) => ({ chunkId: r.id, score: Number(r.score) }));
}

export interface KbSearchChunk extends KbChunkView {
  documentTitle: string;
}

/** Loads chunks for display, with their document titles (scoped to the workspace). */
export async function findChunksForDisplay(
  tx: Executor,
  workspaceId: string,
  chunkIds: string[],
): Promise<KbSearchChunk[]> {
  if (chunkIds.length === 0) return [];
  return tx
    .select({ ...chunkViewColumns, documentTitle: kbDocument.title })
    .from(kbChunk)
    .innerJoin(
      kbDocument,
      and(eq(kbDocument.id, kbChunk.documentId), eq(kbDocument.workspaceId, kbChunk.workspaceId)),
    )
    .where(and(eq(kbChunk.workspaceId, workspaceId), inArray(kbChunk.id, chunkIds)));
}
