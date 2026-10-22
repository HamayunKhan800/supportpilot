import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/platform/db/client";
import {
  EMBEDDING_DIMENSIONS,
  aiUsage,
  kbChunk,
  kbDocument,
  kbDocumentBlob,
  organization,
  user,
} from "@/server/platform/db/schema";
import { transaction } from "@/server/platform/db/tx";
import {
  deleteDocument,
  findDocument,
  findDocumentBySha256,
  getWorkspaceKbUsage,
  insertAiUsage,
  insertDocument,
  listChunks,
  listDocuments,
  listWorkspaceEmbeddingModels,
  lockDocument,
  lockWorkspaceUploads,
  markFailed,
  markProcessing,
  markReady,
  readBlob,
  replaceChunks,
  resetForRetry,
  type KbDocument,
  type NewKbChunk,
} from "@/server/modules/kb/repository";
import { resetDatabase } from "./support/client";

const db = () => getDb().db;

/** PostgreSQL SQLSTATE of a failed query (Drizzle wraps the driver error in `cause`). */
async function sqlState(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code;
  }
}

/** Deterministic unit vector, so tests never depend on an embedding provider. */
function unitVector(seed: number): number[] {
  const v = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => Math.sin(seed * 31 + i));
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

function chunk(content: string, headingPath = "", seed = 1): NewKbChunk {
  return { headingPath, content, tokenEstimate: Math.ceil(content.length / 4), embedding: unitVector(seed) };
}

let counter = 0;
function upload(workspaceId: string, text = `Article ${++counter}`) {
  const bytes = Buffer.from(text);
  return transaction((tx) =>
    insertDocument(tx, workspaceId, {
      title: text,
      filename: `${text}.md`,
      mimeType: "text/markdown",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      uploadedBy: uploaderId,
      bytes,
    }),
  );
}

/** Runs a document through the happy path: processing → chunks → ready. */
async function ingest(workspaceId: string, doc: KbDocument, chunks: NewKbChunk[], model = "mock-hash@768") {
  await transaction(async (tx) => {
    expect(await lockDocument(tx, workspaceId, doc.id)).not.toBeNull();
    expect(await markProcessing(tx, workspaceId, doc.id)).toBe(true);
    await replaceChunks(tx, workspaceId, doc.id, chunks);
    expect(
      await markReady(tx, workspaceId, doc.id, {
        chunkCount: chunks.length,
        tokenEstimate: chunks.reduce((n, c) => n + c.tokenEstimate, 0),
        pageCount: null,
        embeddingModel: model,
      }),
    ).toBe(true);
  });
}

let acmeId: string, globexId: string, uploaderId: string;

beforeAll(async () => {
  await resetDatabase();
  acmeId = randomUUID();
  globexId = randomUUID();
  uploaderId = randomUUID();
  await db()
    .insert(organization)
    .values([
      { id: acmeId, name: "Acme", slug: "acme", createdAt: new Date() },
      { id: globexId, name: "Globex", slug: "globex", createdAt: new Date() },
    ]);
  await db().insert(user).values({ id: uploaderId, name: "Ada Admin", email: "ada@acme.test" });
});

beforeEach(async () => {
  await getDb().pool.query(
    `TRUNCATE "ai_draft_citation", "kb_chunk", "kb_document_blob", "kb_document", "ai_usage"`,
  );
});

describe("FR-K1 upload storage", () => {
  it("stores the document as pending with its blob, and finds it by SHA-256", async () => {
    const doc = await upload(acmeId, "Refund policy");
    expect(doc).toMatchObject({ status: "pending", chunkCount: 0, sizeBytes: 13, errorCode: null });
    expect((await readBlob(db(), acmeId, doc.id))?.toString()).toBe("Refund policy");
    expect((await findDocumentBySha256(db(), acmeId, doc.sha256))?.id).toBe(doc.id);
  });

  it("rejects the same file twice in one workspace, but allows it in another (D7 dedupe)", async () => {
    await upload(acmeId, "Same bytes");
    expect(await sqlState(upload(acmeId, "Same bytes"))).toBe("23505");
    await expect(upload(globexId, "Same bytes")).resolves.toMatchObject({ workspaceId: globexId });
  });

  it("reports document count and stored bytes per workspace (D7 caps)", async () => {
    await upload(acmeId, "aaaa");
    await upload(acmeId, "bbbbbb");
    await upload(globexId, "cc");
    await transaction(async (tx) => {
      await lockWorkspaceUploads(tx, acmeId);
      expect(await getWorkspaceKbUsage(tx, acmeId)).toEqual({ documentCount: 2, totalBytes: 10 });
    });
    expect(await getWorkspaceKbUsage(db(), randomUUID())).toEqual({ documentCount: 0, totalBytes: 0 });
  });

  it("lists newest first", async () => {
    const first = await upload(acmeId);
    const second = await upload(acmeId);
    expect((await listDocuments(acmeId)).map((d) => d.id)).toEqual([second.id, first.id]);
  });
});

describe("database constraints", () => {
  it("rejects a malformed SHA-256, unknown status and unknown MIME type", async () => {
    const doc = await upload(acmeId);
    const set = (values: Partial<typeof kbDocument.$inferInsert>) =>
      sqlState(db().update(kbDocument).set(values).where(eq(kbDocument.id, doc.id)));
    expect(await set({ sha256: "not-a-hash" })).toBe("23514");
    expect(
      await sqlState(db().execute(sql`UPDATE kb_document SET status = 'done' WHERE id = ${doc.id}`)),
    ).toBe("23514");
    expect(
      await sqlState(db().execute(sql`UPDATE kb_document SET mime_type = 'text/html' WHERE id = ${doc.id}`)),
    ).toBe("23514");
  });

  it("requires a reason for failed and a model for ready", async () => {
    const doc = await upload(acmeId);
    const set = (values: Partial<typeof kbDocument.$inferInsert>) =>
      sqlState(db().update(kbDocument).set(values).where(eq(kbDocument.id, doc.id)));
    expect(await set({ status: "failed" })).toBe("23514");
    expect(await set({ status: "ready" })).toBe("23514");
  });

  it("rejects an embedding of the wrong width", async () => {
    const doc = await upload(acmeId);
    const err = await sqlState(
      transaction((tx) => replaceChunks(tx, acmeId, doc.id, [{ ...chunk("x"), embedding: [1, 0, 0] }])),
    );
    expect(err).toBe("22000"); // pgvector: "expected 768 dimensions, not 3"
  });

  it("refuses a chunk that points at another workspace's document (composite FK, T1)", async () => {
    const acmeDoc = await upload(acmeId);
    const err = await sqlState(transaction((tx) => replaceChunks(tx, globexId, acmeDoc.id, [chunk("leak")])));
    expect(err).toBe("23503");
  });
});

describe("FR-K2 ingestion lifecycle", () => {
  it("pending → processing → ready stores ordered chunks and deletes the blob (ADR-0002)", async () => {
    const doc = await upload(acmeId);
    await ingest(acmeId, doc, [
      chunk("Refunds are issued within 5 days.", "Billing › Refunds", 1),
      chunk("Invoices are emailed monthly.", "Billing › Invoices", 2),
    ]);
    const stored = (await findDocument(acmeId, doc.id))!;
    expect(stored).toMatchObject({ status: "ready", chunkCount: 2, embeddingModel: "mock-hash@768" });
    expect(stored.ingestedAt).toBeInstanceOf(Date);
    expect(await readBlob(db(), acmeId, doc.id)).toBeNull();
    const chunks = await listChunks(acmeId, doc.id);
    expect(chunks.map((c) => [c.ordinal, c.headingPath])).toEqual([
      [0, "Billing › Refunds"],
      [1, "Billing › Invoices"],
    ]);
    // People-facing chunk view never exposes the vector or the search column.
    expect(Object.keys(chunks[0]!).sort()).toEqual(
      ["content", "documentId", "headingPath", "id", "ordinal", "tokenEstimate"].sort(),
    );
  });

  it("re-running ingestion replaces chunks instead of duplicating them (D9 idempotency)", async () => {
    const doc = await upload(acmeId);
    await transaction(async (tx) => {
      await markProcessing(tx, acmeId, doc.id);
      await replaceChunks(tx, acmeId, doc.id, [chunk("a"), chunk("b"), chunk("c")]);
    });
    // A crashed attempt left 3 chunks; the retry produces 2. No leftovers, ordinals restart at 0.
    await ingest(acmeId, doc, [chunk("first"), chunk("second")]);
    expect((await listChunks(acmeId, doc.id)).map((c) => [c.ordinal, c.content])).toEqual([
      [0, "first"],
      [1, "second"],
    ]);
  });

  it("inserts large documents in batches", async () => {
    const doc = await upload(acmeId);
    await ingest(
      acmeId,
      doc,
      Array.from({ length: 230 }, (_, i) => chunk(`passage ${i}`, "", i)),
    );
    const chunks = await listChunks(acmeId, doc.id);
    expect(chunks).toHaveLength(230);
    expect(chunks.at(-1)!.ordinal).toBe(229);
  });

  it("only moves forward: ready can't be marked ready again or failed", async () => {
    const doc = await upload(acmeId);
    await ingest(acmeId, doc, [chunk("x")]);
    const result = { chunkCount: 1, tokenEstimate: 1, pageCount: null, embeddingModel: "m" };
    expect(await markReady(db(), acmeId, doc.id, result)).toBe(false);
    expect(await markFailed(db(), acmeId, doc.id, "pdf_too_many_pages")).toBe(false);
    expect(await markProcessing(db(), acmeId, doc.id)).toBe(false);
  });

  it("failing removes leftover chunks and keeps the blob, so the document can be retried", async () => {
    const doc = await upload(acmeId);
    await transaction(async (tx) => {
      await markProcessing(tx, acmeId, doc.id);
      await replaceChunks(tx, acmeId, doc.id, [chunk("partial")]);
    });
    expect(await markFailed(db(), acmeId, doc.id, "embedding_unavailable", 3)).toBe(true);
    expect(await findDocument(acmeId, doc.id)).toMatchObject({
      status: "failed",
      errorCode: "embedding_unavailable",
      pageCount: 3,
      chunkCount: 0,
    });
    expect(await listChunks(acmeId, doc.id)).toEqual([]);
    expect(await readBlob(db(), acmeId, doc.id)).not.toBeNull();

    const retried = await resetForRetry(db(), acmeId, doc.id);
    expect(retried).toMatchObject({ status: "pending", errorCode: null });
  });

  it("retry is refused unless the document failed and its blob still exists", async () => {
    const pending = await upload(acmeId);
    expect(await resetForRetry(db(), acmeId, pending.id)).toBeNull();
    const ready = await upload(acmeId);
    await ingest(acmeId, ready, [chunk("x")]);
    expect(await resetForRetry(db(), acmeId, ready.id)).toBeNull();
    // Failed, but the blob is gone (cannot happen through the app; defend anyway).
    const orphan = await upload(acmeId);
    await markFailed(db(), acmeId, orphan.id, "internal_error");
    await db().delete(kbDocumentBlob).where(eq(kbDocumentBlob.documentId, orphan.id));
    expect(await resetForRetry(db(), acmeId, orphan.id)).toBeNull();
  });

  it("generates an English (stemmed) search vector, with headings weighted above body text (D11)", async () => {
    const doc = await upload(acmeId);
    await ingest(acmeId, doc, [chunk("The desktop app keeps syncing slowly.", "Sync troubleshooting")]);
    const rows = await db()
      .select({ id: kbChunk.id })
      .from(kbChunk)
      .where(sql`${kbChunk.tsv} @@ websearch_to_tsquery('english', 'sync')`);
    expect(rows).toHaveLength(1); // "syncing" in the body and "Sync" in the heading both match "sync".
    const [weights] = await db()
      .execute<{ tsv: string }>(sql`SELECT tsv::text AS tsv FROM kb_chunk LIMIT 1`)
      .then((r) => r.rows);
    expect(weights!.tsv).toContain("'troubleshoot':2A");
  });

  it("reports which embedding models a workspace's ready documents use (D4)", async () => {
    await ingest(acmeId, await upload(acmeId), [chunk("a")], "mock-hash@768");
    await ingest(acmeId, await upload(acmeId), [chunk("b")], "gemini-embedding-2@768");
    await upload(acmeId); // pending: not counted
    expect(await listWorkspaceEmbeddingModels(acmeId)).toEqual(["gemini-embedding-2@768", "mock-hash@768"]);
    expect(await listWorkspaceEmbeddingModels(globexId)).toEqual([]);
  });
});

describe("FR-K3 deletion", () => {
  it("removes the document, its chunks and its blob immediately", async () => {
    const doc = await upload(acmeId);
    await ingest(acmeId, doc, [chunk("a"), chunk("b")]);
    const failed = await upload(acmeId);
    await markFailed(db(), acmeId, failed.id, "pdf_encrypted");

    expect((await deleteDocument(db(), acmeId, doc.id))?.id).toBe(doc.id);
    expect((await deleteDocument(db(), acmeId, failed.id))?.id).toBe(failed.id);
    expect(await findDocument(acmeId, doc.id)).toBeNull();
    expect(await db().select().from(kbChunk)).toEqual([]);
    expect(await db().select().from(kbDocumentBlob)).toEqual([]);
  });
});

describe("tenant isolation (T1, NFR-SEC1)", () => {
  it("another workspace can't find, list, read, lock, change or delete a document", async () => {
    const doc = await upload(acmeId, "Acme secret runbook");
    await upload(globexId, "Globex article");

    expect(await findDocument(globexId, doc.id)).toBeNull();
    expect((await listDocuments(globexId)).map((d) => d.title)).toEqual(["Globex article"]);
    expect(await findDocumentBySha256(db(), globexId, doc.sha256)).toBeNull();
    expect(await readBlob(db(), globexId, doc.id)).toBeNull();
    expect(await transaction((tx) => lockDocument(tx, globexId, doc.id))).toBeNull();
    expect(await markProcessing(db(), globexId, doc.id)).toBe(false);
    expect(await markFailed(db(), globexId, doc.id, "internal_error")).toBe(false);
    expect(await resetForRetry(db(), globexId, doc.id)).toBeNull();
    expect(await deleteDocument(db(), globexId, doc.id)).toBeNull();

    await ingest(acmeId, doc, [chunk("Acme only")]);
    expect(await listChunks(globexId, doc.id)).toEqual([]);
    const result = { chunkCount: 1, tokenEstimate: 1, pageCount: null, embeddingModel: "m" };
    expect(await markReady(db(), globexId, doc.id, result)).toBe(false);
    expect(await findDocument(acmeId, doc.id)).toMatchObject({ status: "ready" });
  });

  it("deleting a workspace removes its knowledge base (ON DELETE CASCADE)", async () => {
    const tempId = randomUUID();
    await db()
      .insert(organization)
      .values({ id: tempId, name: "Temp", slug: `temp-${tempId}`, createdAt: new Date() });
    const doc = await upload(tempId);
    await ingest(tempId, doc, [chunk("x")]);
    await insertAiUsage(db(), tempId, { feature: "embed", model: "m", inputTokens: 5, estCostMicros: 1 });
    await db().delete(organization).where(eq(organization.id, tempId));
    expect(await findDocument(tempId, doc.id)).toBeNull();
    expect(await db().select().from(kbChunk).where(eq(kbChunk.workspaceId, tempId))).toEqual([]);
    expect(await db().select().from(aiUsage).where(eq(aiUsage.workspaceId, tempId))).toEqual([]);
  });
});

describe("AI usage records", () => {
  it("stores embedding usage and rejects unknown features or negative numbers", async () => {
    await insertAiUsage(db(), acmeId, {
      feature: "embed",
      model: "gemini-embedding-2@768",
      inputTokens: 1200,
      estCostMicros: 240,
    });
    expect(await db().select().from(aiUsage)).toMatchObject([
      { workspaceId: acmeId, feature: "embed", inputTokens: 1200, outputTokens: 0, estCostMicros: 240 },
    ]);
    expect(
      await sqlState(
        db().execute(
          sql`INSERT INTO ai_usage (workspace_id, feature, model) VALUES (${acmeId}, 'chat', 'm')`,
        ),
      ),
    ).toBe("23514");
    expect(
      await sqlState(
        insertAiUsage(db(), acmeId, { feature: "embed", model: "m", inputTokens: -1, estCostMicros: 0 }),
      ),
    ).toBe("23514");
  });
});
