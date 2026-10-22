import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createMockEmbedder, type DocumentToEmbed, type Embedder } from "@/server/modules/kb/embedder";
import { IngestError } from "@/server/modules/kb/ingest-errors";
import {
  chunkTitle,
  handleDeadLetter,
  runIngestJob,
  type IngestOutcome,
} from "@/server/modules/kb/ingest-job";
import {
  deleteDocument,
  findDocument,
  insertDocument,
  listChunks,
  resetForRetry,
  type KbDocument,
  type KbMimeType,
} from "@/server/modules/kb/repository";
import { getDb } from "@/server/platform/db/client";
import { aiUsage, kbDocumentBlob, organization, user } from "@/server/platform/db/schema";
import { transaction } from "@/server/platform/db/tx";
import { createBoss, enqueueKbIngest, ensureQueues, stopWebBoss } from "@/server/platform/jobs/boss";
import { KB_INGEST_DEAD_LETTER_QUEUE, KB_INGEST_QUEUE, QUEUE_SETTINGS } from "@/server/platform/jobs/queues";
import { registerKbHandlers } from "@/worker/handlers";

import { buildPdf, manyPages } from "../support/pdf";
import { resetDatabase } from "./support/client";

const db = () => getDb().db;
const pool = () => getDb().pool;

let acmeId: string, globexId: string, uploaderId: string;
let counter = 0;

const MARKDOWN =
  "# Billing\n\n## Refunds\n\nRefunds take 5 business days.\n\n# Shipping\n\nWe ship worldwide.";

async function upload(
  workspaceId: string,
  bytes: Uint8Array,
  mimeType: KbMimeType = "text/markdown",
): Promise<KbDocument> {
  const n = ++counter;
  const buf = Buffer.from(bytes);
  return transaction((tx) =>
    insertDocument(tx, workspaceId, {
      title: `Guide ${n}`,
      filename: `guide-${n}`,
      mimeType,
      // Unique per upload so the same content can be used in several tests.
      sha256: createHash("sha256").update(buf).update(String(n)).digest("hex"),
      uploadedBy: uploaderId,
      bytes: buf,
    }),
  );
}

const md = (text = MARKDOWN) => new TextEncoder().encode(text);
const payload = (doc: KbDocument) => ({ workspaceId: doc.workspaceId, documentId: doc.id });
const first = { isFinalAttempt: false };
const last = { isFinalAttempt: true };

/** An embedder that records what it was asked to embed. */
function spyEmbedder() {
  const inner = createMockEmbedder();
  const calls: DocumentToEmbed[][] = [];
  const embedder: Embedder = {
    modelId: inner.modelId,
    embedQuery: inner.embedQuery,
    async embedDocuments(items, signal) {
      calls.push(items);
      return inner.embedDocuments(items, signal);
    },
  };
  return { embedder, calls };
}

/** An embedder that waits at a gate, to interleave concurrent actions deterministically. */
function gatedEmbedder() {
  const inner = createMockEmbedder();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let arrivals = 0;
  const waiters: Array<() => void> = [];
  const embedder: Embedder = {
    modelId: inner.modelId,
    embedQuery: inner.embedQuery,
    async embedDocuments(items, signal) {
      arrivals++;
      waiters.splice(0).forEach((w) => w());
      await gate;
      return inner.embedDocuments(items, signal);
    },
  };
  const arrived = (count: number) =>
    new Promise<void>((resolve) => {
      const check = () => (arrivals >= count ? resolve() : waiters.push(check));
      check();
    });
  return { embedder, release, arrived };
}

function failingEmbedder(error: Error) {
  let calls = 0;
  const embedder: Embedder = {
    modelId: "mock-hash@768",
    embedQuery: () => Promise.reject(error),
    embedDocuments: () => {
      calls++;
      return Promise.reject(error);
    },
  };
  return { embedder, calls: () => calls };
}

async function usageRows(workspaceId: string) {
  return db().select().from(aiUsage).where(eq(aiUsage.workspaceId, workspaceId));
}

async function hasBlob(documentId: string) {
  const rows = await db().select().from(kbDocumentBlob).where(eq(kbDocumentBlob.documentId, documentId));
  return rows.length === 1;
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 100));
  }
}

const docWithStatus = (doc: KbDocument, status: KbDocument["status"]) => async () => {
  const current = await findDocument(doc.workspaceId, doc.id);
  return current?.status === status ? current : null;
};

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
  await pool().query(
    `TRUNCATE "kb_chunk", "kb_document_blob", "kb_document", "ai_usage" RESTART IDENTITY CASCADE`,
  );
  await pool().query(`DELETE FROM pgboss.job`);
});

afterAll(async () => {
  await stopWebBoss();
});

describe("runIngestJob", () => {
  it("ingests Markdown: chunks with heading trails, embeddings, usage, blob removed", async () => {
    const doc = await upload(acmeId, md());
    const { embedder, calls } = spyEmbedder();

    const outcome = await runIngestJob(payload(doc), first, { embedder });

    expect(outcome).toEqual({ status: "ready", chunkCount: 2 });
    const ready = await findDocument(acmeId, doc.id);
    expect(ready).toMatchObject({
      status: "ready",
      errorCode: null,
      chunkCount: 2,
      pageCount: null,
      embeddingModel: "mock-hash@768",
    });
    expect(ready!.ingestedAt).toBeInstanceOf(Date);
    expect(ready!.tokenEstimate).toBeGreaterThan(0);
    expect(await hasBlob(doc.id)).toBe(false);

    const chunks = await listChunks(acmeId, doc.id);
    expect(chunks.map((c) => [c.headingPath, c.content])).toEqual([
      ["Billing › Refunds", "Refunds take 5 business days."],
      ["Shipping", "We ship worldwide."],
    ]);
    // The embedder saw each chunk with its document title and heading trail.
    expect(calls[0]!.map((i) => i.title)).toEqual([
      `${doc.title} › Billing › Refunds`,
      `${doc.title} › Shipping`,
    ]);

    const usage = await usageRows(acmeId);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ feature: "embed", model: "mock-hash@768", estCostMicros: 0 });
    expect(usage[0]!.inputTokens).toBeGreaterThan(0);
  });

  it("ingests a PDF in the sandboxed thread, one section per page", async () => {
    const doc = await upload(
      acmeId,
      buildPdf({ pages: [["Reset your password from Settings."], ["Contact support."]] }),
      "application/pdf",
    );
    expect(await runIngestJob(payload(doc), first, { embedder: createMockEmbedder() })).toEqual({
      status: "ready",
      chunkCount: 2,
    });
    expect((await findDocument(acmeId, doc.id))!.pageCount).toBe(2);
    expect((await listChunks(acmeId, doc.id)).map((c) => c.headingPath)).toEqual(["Page 1", "Page 2"]);
  });

  it("fails a password-protected PDF permanently, keeping the bytes so it can be retried", async () => {
    const doc = await upload(acmeId, buildPdf({ userPassword: "s3cret" }), "application/pdf");
    const outcome = await runIngestJob(payload(doc), first, { embedder: createMockEmbedder() });

    expect(outcome).toEqual({ status: "failed", errorCode: "pdf_encrypted" });
    expect(await findDocument(acmeId, doc.id)).toMatchObject({
      status: "failed",
      errorCode: "pdf_encrypted",
      chunkCount: 0,
    });
    expect(await listChunks(acmeId, doc.id)).toEqual([]);
    expect(await usageRows(acmeId)).toEqual([]); // nothing was embedded
    expect(await hasBlob(doc.id)).toBe(true);
    expect(await transaction((tx) => resetForRetry(tx, acmeId, doc.id))).toMatchObject({ status: "pending" });
  });

  it("records the page count of a PDF rejected for having too many pages", async () => {
    const doc = await upload(acmeId, manyPages(51), "application/pdf");
    expect(await runIngestJob(payload(doc), first, { embedder: createMockEmbedder() })).toEqual({
      status: "failed",
      errorCode: "pdf_too_many_pages",
    });
    expect(await findDocument(acmeId, doc.id)).toMatchObject({ status: "failed", pageCount: 51 });
  });

  it("throws a temporary failure for retry, and records it on the final attempt", async () => {
    const doc = await upload(acmeId, md());
    const { embedder, calls } = failingEmbedder(new IngestError("embedding_unavailable"));

    await expect(runIngestJob(payload(doc), first, { embedder })).rejects.toMatchObject({
      code: "embedding_unavailable",
    });
    expect(await findDocument(acmeId, doc.id)).toMatchObject({ status: "processing", errorCode: null });

    expect(await runIngestJob(payload(doc), last, { embedder })).toEqual({
      status: "failed",
      errorCode: "embedding_unavailable",
    });
    expect(await findDocument(acmeId, doc.id)).toMatchObject({
      status: "failed",
      errorCode: "embedding_unavailable",
    });
    expect(calls()).toBe(2);
  });

  it("treats an unexpected error as a temporary internal error", async () => {
    const doc = await upload(acmeId, md());
    const { embedder } = failingEmbedder(new Error("socket hang up"));
    await expect(runIngestJob(payload(doc), first, { embedder })).rejects.toMatchObject({
      code: "internal_error",
    });
    expect(await runIngestJob(payload(doc), last, { embedder })).toEqual({
      status: "failed",
      errorCode: "internal_error",
    });
  });

  it("is idempotent: a second run of a finished job changes nothing", async () => {
    const doc = await upload(acmeId, md());
    await runIngestJob(payload(doc), first, { embedder: createMockEmbedder() });
    const { embedder, calls } = spyEmbedder();

    expect(await runIngestJob(payload(doc), first, { embedder })).toEqual({
      status: "skipped",
      reason: "not_pending",
    });
    expect(calls).toHaveLength(0);
    expect(await listChunks(acmeId, doc.id)).toHaveLength(2);
    expect(await usageRows(acmeId)).toHaveLength(1);
  });

  it("two copies of the same job running at once produce one set of chunks", async () => {
    const doc = await upload(acmeId, md());
    const { embedder, release, arrived } = gatedEmbedder();

    const a = runIngestJob(payload(doc), first, { embedder });
    const b = runIngestJob(payload(doc), first, { embedder });
    await arrived(2); // both runs claimed the document and are embedding
    release();
    const outcomes = (await Promise.all([a, b])).map((o: IngestOutcome) => o.status).sort();

    expect(outcomes).toEqual(["ready", "skipped"]);
    expect(await listChunks(acmeId, doc.id)).toHaveLength(2);
    expect((await findDocument(acmeId, doc.id))!.chunkCount).toBe(2);
    expect(await usageRows(acmeId)).toHaveLength(2); // both runs spent tokens
  });

  it("drops the result when the document is deleted while it is being embedded", async () => {
    const doc = await upload(acmeId, md());
    const { embedder, release, arrived } = gatedEmbedder();

    const running = runIngestJob(payload(doc), first, { embedder });
    await arrived(1);
    expect(await transaction((tx) => deleteDocument(tx, acmeId, doc.id))).not.toBeNull();
    release();

    expect(await running).toEqual({ status: "skipped", reason: "deleted" });
    const orphans = await pool().query("SELECT count(*)::int AS n FROM kb_chunk WHERE document_id = $1", [
      doc.id,
    ]);
    expect(orphans.rows[0].n).toBe(0);
    expect(await usageRows(acmeId)).toHaveLength(1); // the spend is still recorded
  });

  it("does nothing for a job that names another workspace (tenant isolation)", async () => {
    const doc = await upload(acmeId, md());
    const { embedder, calls } = spyEmbedder();
    expect(await runIngestJob({ workspaceId: globexId, documentId: doc.id }, first, { embedder })).toEqual({
      status: "skipped",
      reason: "deleted",
    });
    expect(calls).toHaveLength(0);
    expect((await findDocument(acmeId, doc.id))!.status).toBe("pending");
  });

  it("skips a document that already failed", async () => {
    const doc = await upload(acmeId, buildPdf({ userPassword: "x" }), "application/pdf");
    await runIngestJob(payload(doc), first, { embedder: createMockEmbedder() });
    expect(await runIngestJob(payload(doc), first, { embedder: createMockEmbedder() })).toEqual({
      status: "skipped",
      reason: "not_pending",
    });
  });
});

describe("handleDeadLetter", () => {
  it("marks a stuck document failed, but never touches a finished or deleted one", async () => {
    const stuck = await upload(acmeId, md());
    await expect(
      runIngestJob(payload(stuck), first, { embedder: failingEmbedder(new Error("x")).embedder }),
    ).rejects.toThrow();
    expect((await findDocument(acmeId, stuck.id))!.status).toBe("processing");
    expect(await handleDeadLetter(payload(stuck))).toBe(true);
    expect(await findDocument(acmeId, stuck.id)).toMatchObject({
      status: "failed",
      errorCode: "internal_error",
    });

    const done = await upload(acmeId, md());
    await runIngestJob(payload(done), first, { embedder: createMockEmbedder() });
    expect(await handleDeadLetter(payload(done))).toBe(false);
    expect((await findDocument(acmeId, done.id))!.status).toBe("ready");

    expect(await handleDeadLetter({ workspaceId: acmeId, documentId: randomUUID() })).toBe(false);
  });
});

describe("job queue (pg-boss)", () => {
  const jobsFor = async (documentId: string, queue = KB_INGEST_QUEUE) => {
    const r = await pool().query(
      "SELECT state FROM pgboss.job WHERE name = $1 AND data->>'documentId' = $2",
      [queue, documentId],
    );
    return r.rows as Array<{ state: string }>;
  };

  // Admin handle for reading and adjusting queue settings.
  let createdBoss: PgBoss | undefined;
  beforeAll(async () => {
    createdBoss = createBoss(process.env.DATABASE_URL!, "web");
    await createdBoss.start();
  });
  afterAll(async () => {
    await createdBoss?.stop({ graceful: false });
  });

  let workers: PgBoss[] = [];
  async function startWorker(embedder: Embedder): Promise<PgBoss> {
    const boss = createBoss(process.env.DATABASE_URL!, "worker", 2);
    await boss.start();
    await registerKbHandlers(boss, { embedder }, { pollingIntervalSeconds: 0.5 });
    workers.push(boss);
    return boss;
  }

  afterEach(async () => {
    await Promise.all(workers.map((w) => w.stop({ graceful: false })));
    workers = [];
    await ensureQueues(createdBoss!, QUEUE_SETTINGS); // restore settings changed by a test
  });

  it("installs the queues with the settings from code", async () => {
    const queue = await createdBoss!.getQueue(KB_INGEST_QUEUE);
    expect(queue).toMatchObject({
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 600,
      deadLetter: KB_INGEST_DEAD_LETTER_QUEUE,
    });
    expect(await createdBoss!.getQueue(KB_INGEST_DEAD_LETTER_QUEUE)).not.toBeNull();
  });

  it("enqueues in the caller's transaction: committed with the document, gone on rollback", async () => {
    const committed = await transaction(async (tx) => {
      const doc = await insertDocument(tx, acmeId, {
        title: "T",
        filename: "t.md",
        mimeType: "text/markdown",
        sha256: "a".repeat(64),
        uploadedBy: uploaderId,
        bytes: Buffer.from("# T\n\nx"),
      });
      await enqueueKbIngest(tx, payload(doc));
      return doc;
    });
    expect(await jobsFor(committed.id)).toEqual([{ state: "created" }]);

    const docId = randomUUID();
    await expect(
      transaction(async (tx) => {
        await enqueueKbIngest(tx, { workspaceId: acmeId, documentId: docId });
        throw new Error("upload failed after enqueue");
      }),
    ).rejects.toThrow("upload failed after enqueue");
    expect(await jobsFor(docId)).toEqual([]);
  });

  it("refuses a malformed payload before it reaches the queue", async () => {
    await expect(
      transaction((tx) => enqueueKbIngest(tx, { workspaceId: acmeId, documentId: "not-a-uuid" })),
    ).rejects.toThrow();
    const r = await pool().query("SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1", [
      KB_INGEST_QUEUE,
    ]);
    expect(r.rows[0].n).toBe(0);
  });

  it("end to end: upload + enqueue in one transaction, the worker makes the document ready", async () => {
    await startWorker(createMockEmbedder());
    const doc = await transaction(async (tx) => {
      const d = await insertDocument(tx, acmeId, {
        title: "Handbook",
        filename: "handbook.md",
        mimeType: "text/markdown",
        sha256: "b".repeat(64),
        uploadedBy: uploaderId,
        bytes: Buffer.from(MARKDOWN),
      });
      await enqueueKbIngest(tx, payload(d));
      return d;
    });

    const ready = await waitFor(docWithStatus(doc, "ready"));
    expect(ready.chunkCount).toBe(2);
    expect(await waitFor(async () => (await jobsFor(doc.id))[0]?.state === "completed")).toBe(true);
  }, 30_000);

  it("end to end: a temporary failure is retried by pg-boss, then recorded on the final attempt", async () => {
    // Fast retries for the test (pg-boss allows retryDelayMax only with backoff).
    const { retryDelayMax: _unused, ...ingest } = QUEUE_SETTINGS[KB_INGEST_QUEUE]!;
    await ensureQueues(createdBoss!, {
      ...QUEUE_SETTINGS,
      [KB_INGEST_QUEUE]: { ...ingest, retryLimit: 1, retryDelay: 1, retryBackoff: false },
    });
    const failing = failingEmbedder(new IngestError("embedding_unavailable"));
    await startWorker(failing.embedder);
    const doc = await upload(acmeId, md());
    await transaction((tx) => enqueueKbIngest(tx, payload(doc)));

    const failed = await waitFor(docWithStatus(doc, "failed"), 20_000);
    expect(failed.errorCode).toBe("embedding_unavailable");
    expect(failing.calls()).toBe(2); // first attempt + one retry (retryLimit 1)
    // The handler recorded the failure itself, so nothing went to the dead-letter queue.
    expect(await jobsFor(doc.id, KB_INGEST_DEAD_LETTER_QUEUE)).toEqual([]);
  }, 30_000);

  it("end to end: the dead-letter worker fails a stuck document; malformed jobs are dropped", async () => {
    const boss = await startWorker(createMockEmbedder());
    const stuck = await upload(acmeId, md());
    await pool().query("UPDATE kb_document SET status = 'processing' WHERE id = $1", [stuck.id]);

    await boss.send(KB_INGEST_DEAD_LETTER_QUEUE, payload(stuck));
    expect((await waitFor(docWithStatus(stuck, "failed"))).errorCode).toBe("internal_error");

    const malformedId = await boss.send(KB_INGEST_QUEUE, { documentId: "nope" });
    const done = await waitFor(async () => {
      const r = await pool().query("SELECT state, output FROM pgboss.job WHERE id = $1", [malformedId]);
      return r.rows[0]?.state === "completed" ? r.rows[0] : null;
    });
    expect(done.output).toEqual({ status: "malformed" });
  }, 30_000);
});

// Keeps the helper honest: titles join with the same separator as heading trails.
describe("chunkTitle", () => {
  it("joins the document title and heading trail", () => {
    expect(chunkTitle("Guide", "Billing › Refunds")).toBe("Guide › Billing › Refunds");
    expect(chunkTitle("Guide", "")).toBe("Guide");
  });
});
