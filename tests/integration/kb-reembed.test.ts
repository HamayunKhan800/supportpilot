import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createMockEmbedder, type Embedder } from "@/server/modules/kb/embedder";
import { IngestError } from "@/server/modules/kb/ingest-errors";
import { chunkTitle, runIngestJob } from "@/server/modules/kb/ingest-job";
import { reembedDocument, reembedWorkspace } from "@/server/modules/kb/reembed";
import {
  deleteDocument,
  findDocument,
  insertDocument,
  listChunks,
  type KbDocument,
} from "@/server/modules/kb/repository";
import { hybridSearch } from "@/server/modules/kb/service";
import { getDb } from "@/server/platform/db/client";
import { aiUsage, kbChunk, kbDocument, organization } from "@/server/platform/db/schema";
import { transaction } from "@/server/platform/db/tx";

import { resetDatabase } from "./support/client";

const db = () => getDb().db;
const current = createMockEmbedder();

/** Stands in for the model a workspace used before: same shape, different id and vectors. */
function oldModel(): Embedder {
  const inner = createMockEmbedder();
  const flip = (v: number[]) => v.map((x) => -x);
  return {
    modelId: "old-model@768",
    async embedDocuments(items) {
      const b = await inner.embedDocuments(items);
      return { ...b, embeddings: b.embeddings.map(flip) };
    },
    async embedQuery(q) {
      const r = await inner.embedQuery(q);
      return { ...r, embedding: flip(r.embedding) };
    },
  };
}

/** The current model, with a hook that runs during the embedding call (to stage races). */
function withHook(during: () => Promise<void>): Embedder & { calls: number } {
  const e = {
    modelId: current.modelId,
    calls: 0,
    async embedDocuments(items: Parameters<Embedder["embedDocuments"]>[0]) {
      e.calls++;
      await during();
      return current.embedDocuments(items);
    },
    embedQuery: (q: string) => current.embedQuery(q),
  };
  return e;
}

let acme: string, globex: string;
let n = 0;

async function ingest(workspaceId: string, markdown: string, embedder = oldModel()): Promise<KbDocument> {
  const bytes = Buffer.from(markdown);
  const doc = await transaction((tx) =>
    insertDocument(tx, workspaceId, {
      title: `Guide ${++n}`,
      filename: `guide-${n}.md`,
      mimeType: "text/markdown",
      sha256: createHash("sha256").update(bytes).update(String(n)).digest("hex"),
      uploadedBy: null,
      bytes,
    }),
  );
  const outcome = await runIngestJob(
    { workspaceId, documentId: doc.id },
    { isFinalAttempt: true },
    { embedder },
  );
  expect(outcome.status).toBe("ready");
  return (await findDocument(workspaceId, doc.id))!;
}

const REFUNDS =
  "# Refunds\n\n## Annual plans\n\nAnnual plans are refunded within 30 days.\n\n## Monthly\n\nNo partial refunds.";
const SYNC = "# Sync\n\nError NC-507 means your storage is full.";

beforeAll(async () => {
  await resetDatabase();
  acme = randomUUID();
  globex = randomUUID();
  await db()
    .insert(organization)
    .values([
      { id: acme, name: "Acme", slug: "acme", createdAt: new Date() },
      { id: globex, name: "Globex", slug: "globex", createdAt: new Date() },
    ]);
});

beforeEach(async () => {
  await getDb().pool.query(`TRUNCATE "kb_chunk", "kb_document_blob", "kb_document", "ai_usage" CASCADE`);
});

describe("reembedWorkspace (D4: pnpm kb:reembed)", () => {
  it("moves a workspace onto the current model, so search works again", async () => {
    const a = await ingest(acme, REFUNDS);
    const b = await ingest(acme, SYNC);
    await expect(hybridSearch(acme, "refund", current)).rejects.toMatchObject({
      status: 409,
      code: "embedding_model_mismatch",
    });
    const before = await listChunks(acme, a.id);

    const summary = await reembedWorkspace(acme, current);
    expect(summary).toEqual({
      model: current.modelId,
      reembedded: 2,
      skipped: 0,
      chunks: a.chunkCount + b.chunkCount,
    });

    // Same passages and ids; new vectors equal to what ingestion with this model produces.
    const after = await listChunks(acme, a.id);
    expect(after.map((c) => [c.id, c.content])).toEqual(before.map((c) => [c.id, c.content]));
    const [stored] = await db().select().from(kbChunk).where(eq(kbChunk.id, after[0]!.id));
    const { embeddings } = await current.embedDocuments([
      { title: chunkTitle(a.title, after[0]!.headingPath), text: after[0]!.content },
    ]);
    stored!.embedding!.forEach((x, i) => expect(x).toBeCloseTo(embeddings[0]![i]!, 5));
    expect((await findDocument(acme, a.id))!.embeddingModel).toBe(current.modelId);

    const res = await hybridSearch(acme, "How long do I have to get a refund on an annual plan?", current);
    expect(res.results[0]!.document.id).toBe(a.id);
    const usage = await db().select().from(aiUsage).where(eq(aiUsage.model, current.modelId));
    expect(usage.length).toBeGreaterThanOrEqual(2);
  });

  it("does nothing on a second run, and leaves other workspaces alone", async () => {
    await ingest(acme, REFUNDS);
    const other = await ingest(globex, SYNC);
    await reembedWorkspace(acme, current);

    const spy = withHook(async () => {});
    expect(await reembedWorkspace(acme, spy)).toMatchObject({ reembedded: 0, skipped: 0 });
    expect(spy.calls).toBe(0);
    expect((await findDocument(globex, other.id))!.embeddingModel).toBe("old-model@768");
  });

  it("skips documents that are not ready", async () => {
    await ingest(acme, REFUNDS);
    await db().update(kbDocument).set({ status: "pending" }).where(eq(kbDocument.workspaceId, acme));
    expect(await reembedWorkspace(acme, current)).toMatchObject({ reembedded: 0 });
  });

  it("writes nothing if the document is deleted, reprocessed or re-chunked during the API call", async () => {
    const deleted = await ingest(acme, REFUNDS);
    expect(
      await reembedDocument(
        acme,
        deleted.id,
        withHook(() => transaction((tx) => deleteDocument(tx, acme, deleted.id).then(() => {}))),
      ),
    ).toEqual({ status: "skipped", reason: "deleted" });

    const reset = await ingest(acme, SYNC);
    const toPending = () =>
      db()
        .update(kbDocument)
        .set({ status: "pending" })
        .where(eq(kbDocument.id, reset.id))
        .then(() => {});
    expect(await reembedDocument(acme, reset.id, withHook(toPending))).toEqual({
      status: "skipped",
      reason: "not_ready",
    });

    const rechunked = await ingest(acme, REFUNDS + "\n\nMore text.");
    const dropOne = async () => {
      const [first] = await listChunks(acme, rechunked.id);
      await db().delete(kbChunk).where(eq(kbChunk.id, first!.id));
    };
    expect(await reembedDocument(acme, rechunked.id, withHook(dropOne))).toEqual({
      status: "skipped",
      reason: "changed",
    });
    expect((await findDocument(acme, rechunked.id))!.embeddingModel).toBe("old-model@768");
  });

  it("stops on a provider failure and leaves the document on its old model", async () => {
    const doc = await ingest(acme, REFUNDS);
    const failing = withHook(async () => {
      throw new IngestError("embedding_unavailable");
    });
    await expect(reembedWorkspace(acme, failing)).rejects.toMatchObject({ code: "embedding_unavailable" });
    expect((await findDocument(acme, doc.id))!.embeddingModel).toBe("old-model@768");
  });
});
