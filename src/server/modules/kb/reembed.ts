/**
 * Re-embedding (plan D4, `pnpm kb:reembed`). Search refuses a workspace whose documents were
 * embedded with a different model than the one it searches with, because vectors from two
 * models can't be compared. This brings every ready document onto the current model.
 *
 * The original files are gone after ingestion (D6), so the stored passages are embedded
 * again, with the same "Document › Section" titles as ingestion. Passages and their ids stay
 * the same; only the vectors and the document's `embedding_model` change.
 *
 * Safe to stop and re-run: it only picks documents still on another model, and each document
 * is switched in its own transaction. The embedding call happens before the transaction, so
 * no lock is held during a slow API call; the write is skipped if the document was deleted,
 * left `ready`, or had its passages replaced meanwhile.
 */
import { transaction } from "@/server/platform/db/tx";
import { getDb } from "@/server/platform/db/client";

import { embeddingCostMicros, type Embedder } from "./embedder";
import { chunkTitle } from "./ingest-job";
import * as repo from "./repository";

export type ReembedOutcome =
  | { status: "reembedded"; chunkCount: number }
  | { status: "skipped"; reason: "deleted" | "not_ready" | "changed" };

const sameIds = (a: readonly { id: string }[], b: readonly { id: string }[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i]!.id);

export async function reembedDocument(
  workspaceId: string,
  documentId: string,
  embedder: Embedder,
  signal?: AbortSignal,
): Promise<ReembedOutcome> {
  const doc = await repo.findDocument(workspaceId, documentId);
  if (!doc) return { status: "skipped", reason: "deleted" };
  if (doc.status !== "ready") return { status: "skipped", reason: "not_ready" };
  const chunks = await repo.listChunkTexts(getDb().db, workspaceId, documentId);

  const { embeddings, tokenEstimate } = await embedder.embedDocuments(
    chunks.map((c) => ({ title: chunkTitle(doc.title, c.headingPath), text: c.content })),
    signal,
  );

  return transaction(async (tx) => {
    // Tokens were spent whatever happens next (as in ingestion).
    await repo.insertAiUsage(tx, workspaceId, {
      feature: "embed",
      model: embedder.modelId,
      inputTokens: tokenEstimate,
      estCostMicros: embeddingCostMicros(embedder.modelId, tokenEstimate),
    });
    const current = await repo.lockDocument(tx, workspaceId, documentId);
    if (!current) return { status: "skipped", reason: "deleted" } as const;
    if (current.status !== "ready") return { status: "skipped", reason: "not_ready" } as const;
    if (!sameIds(await repo.listChunkTexts(tx, workspaceId, documentId), chunks)) {
      return { status: "skipped", reason: "changed" } as const;
    }
    await repo.replaceEmbeddings(
      tx,
      workspaceId,
      documentId,
      embedder.modelId,
      chunks.map((c, i) => ({ id: c.id, embedding: embeddings[i]! })),
    );
    return { status: "reembedded", chunkCount: chunks.length } as const;
  });
}

export interface ReembedSummary {
  model: string;
  reembedded: number;
  skipped: number;
  chunks: number;
}

/** Re-embeds every ready document of the workspace that is on another model. */
export async function reembedWorkspace(
  workspaceId: string,
  embedder: Embedder,
  onDocument?: (title: string, outcome: ReembedOutcome) => void,
): Promise<ReembedSummary> {
  const summary: ReembedSummary = { model: embedder.modelId, reembedded: 0, skipped: 0, chunks: 0 };
  for (const doc of await repo.listDocumentsToReembed(workspaceId, embedder.modelId)) {
    const outcome = await reembedDocument(workspaceId, doc.id, embedder);
    if (outcome.status === "reembedded") {
      summary.reembedded++;
      summary.chunks += outcome.chunkCount;
    } else {
      summary.skipped++;
    }
    onDocument?.(doc.title, outcome);
  }
  return summary;
}
