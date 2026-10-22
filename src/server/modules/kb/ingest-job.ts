import type { Logger } from "pino";

import { transaction } from "@/server/platform/db/tx";
import type { KbIngestPayload } from "@/server/platform/jobs/queues";
import { logger as defaultLogger } from "@/server/platform/logger";

import { HEADING_SEPARATOR } from "./chunker";
import { embeddingCostMicros, type Embedder } from "./embedder";
import { IngestError } from "./ingest-errors";
import { prepareDocument, type PrepareOptions } from "./prepare";
import {
  insertAiUsage,
  lockDocument,
  markFailed,
  markProcessing,
  markReady,
  readBlob,
  replaceChunks,
  type KbDocument,
} from "./repository";

/**
 * The kb.ingest job (plan M4 D9): stored bytes → text → chunks → embeddings → `ready`.
 *
 * Idempotent and safe to run twice at once, without relying on pg-boss deduplication:
 *  1. A short transaction locks the document, marks it `processing` and reads its bytes.
 *  2. Extraction and embedding (slow, possibly remote) run with no lock or transaction held.
 *  3. A second short transaction locks the document again. If it was deleted, or another
 *     run already finished or failed it, the result is dropped. Otherwise all chunks are
 *     replaced and the document becomes `ready` in one commit.
 *
 * Failures: permanent ones (the file is the problem) mark the document `failed` at once.
 * Temporary ones are thrown so pg-boss retries them with backoff; on the final attempt the
 * document is marked `failed` here instead, so it never stays `processing`.
 */

export interface IngestDeps {
  embedder: Embedder;
  prepare?: PrepareOptions;
  logger?: Logger;
}

export interface IngestAttempt {
  /** True when pg-boss will not retry this job again. */
  isFinalAttempt: boolean;
  /** Aborted by pg-boss when the job expires or the worker shuts down. */
  signal?: AbortSignal;
}

export type IngestOutcome =
  | { status: "ready"; chunkCount: number }
  | { status: "failed"; errorCode: string }
  | { status: "skipped"; reason: "deleted" | "not_pending" | "superseded" };

/** Text given to the embedder as each chunk's title: "Document › Section › Subsection". */
export function chunkTitle(documentTitle: string, headingPath: string): string {
  return headingPath ? `${documentTitle}${HEADING_SEPARATOR}${headingPath}` : documentTitle;
}

type Claimed = { doc: KbDocument; bytes: Buffer } | { skipped: "deleted" | "not_pending" };

async function claim({ workspaceId, documentId }: KbIngestPayload): Promise<Claimed> {
  return transaction(async (tx) => {
    const doc = await lockDocument(tx, workspaceId, documentId);
    if (!doc) return { skipped: "deleted" };
    if (doc.status !== "pending" && doc.status !== "processing") return { skipped: "not_pending" };
    await markProcessing(tx, workspaceId, documentId);
    const bytes = await readBlob(tx, workspaceId, documentId);
    // Bytes are only removed when a document becomes ready, so this means corrupted state.
    if (!bytes) throw new IngestError("internal_error", { cause: new Error("document bytes missing") });
    return { doc, bytes };
  });
}

async function recordFailure(payload: KbIngestPayload, err: IngestError): Promise<boolean> {
  return transaction(async (tx) => {
    const doc = await lockDocument(tx, payload.workspaceId, payload.documentId);
    if (!doc) return false;
    return markFailed(tx, payload.workspaceId, payload.documentId, err.code, err.pageCount);
  });
}

export async function runIngestJob(
  payload: KbIngestPayload,
  attempt: IngestAttempt,
  deps: IngestDeps,
): Promise<IngestOutcome> {
  const log = (deps.logger ?? defaultLogger).child({ job: "kb.ingest", ...payload });
  const started = Date.now();
  try {
    const claimed = await claim(payload);
    if ("skipped" in claimed) {
      log.info({ outcome: "skipped", reason: claimed.skipped }, "ingest skipped");
      return { status: "skipped", reason: claimed.skipped };
    }
    const { doc, bytes } = claimed;

    const prepared = await prepareDocument(doc.mimeType, bytes, deps.prepare);
    const { embeddings, tokenEstimate } = await deps.embedder.embedDocuments(
      prepared.chunks.map((c) => ({ title: chunkTitle(doc.title, c.headingPath), text: c.content })),
      attempt.signal,
    );

    const saved = await transaction(async (tx) => {
      // Tokens were spent whatever happens next, so usage is always recorded (NFR cost).
      await insertAiUsage(tx, payload.workspaceId, {
        feature: "embed",
        model: deps.embedder.modelId,
        inputTokens: tokenEstimate,
        estCostMicros: embeddingCostMicros(deps.embedder.modelId, tokenEstimate),
      });
      const current = await lockDocument(tx, payload.workspaceId, payload.documentId);
      if (!current) return "deleted" as const;
      // Finished or failed by another run of the same job meanwhile. Every run reads the same
      // stored bytes, so there is nothing newer to write.
      if (current.status !== "processing") return "superseded" as const;
      await replaceChunks(
        tx,
        payload.workspaceId,
        payload.documentId,
        prepared.chunks.map((c, i) => ({ ...c, embedding: embeddings[i]! })),
      );
      await markReady(tx, payload.workspaceId, payload.documentId, {
        chunkCount: prepared.chunks.length,
        tokenEstimate: prepared.chunks.reduce((n, c) => n + c.tokenEstimate, 0),
        pageCount: prepared.pageCount,
        embeddingModel: deps.embedder.modelId,
      });
      return "ready" as const;
    });

    if (saved !== "ready") {
      log.info(
        { outcome: "skipped", reason: saved, durationMs: Date.now() - started },
        "ingest result dropped",
      );
      return { status: "skipped", reason: saved };
    }
    log.info(
      {
        outcome: "ready",
        chunkCount: prepared.chunks.length,
        tokenEstimate,
        durationMs: Date.now() - started,
      },
      "document ingested",
    );
    return { status: "ready", chunkCount: prepared.chunks.length };
  } catch (cause) {
    const err = cause instanceof IngestError ? cause : new IngestError("internal_error", { cause });
    const willRetry = !err.permanent && !attempt.isFinalAttempt;
    log.warn(
      {
        outcome: willRetry ? "retry" : "failed",
        errorCode: err.code,
        // Cause class and message only: never document text.
        cause:
          err.cause instanceof Error ? `${err.cause.name}: ${err.cause.message}`.slice(0, 300) : undefined,
        durationMs: Date.now() - started,
      },
      willRetry ? "ingest failed, will retry" : "ingest failed",
    );
    if (willRetry) throw err;
    await recordFailure(payload, err);
    return { status: "failed", errorCode: err.code };
  }
}

/**
 * Dead-letter handler: the job failed without the handler recording it (the worker
 * crashed, was killed, or the job expired). The document must not stay `processing`.
 * markFailed only changes pending/processing documents, so this cannot undo a result.
 */
export async function handleDeadLetter(
  payload: KbIngestPayload,
  deps: { logger?: Logger } = {},
): Promise<boolean> {
  const changed = await recordFailure(payload, new IngestError("internal_error"));
  (deps.logger ?? defaultLogger).warn({ job: "kb.ingest.dead", ...payload, changed }, "ingest dead-lettered");
  return changed;
}
