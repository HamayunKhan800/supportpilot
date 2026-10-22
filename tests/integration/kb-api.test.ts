import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KbDocument, KbDocumentDetail, KbDocumentList, KbSearchResults, Problem } from "@/server/api/schemas";
import { createGeminiEmbedder, createMockEmbedder, type Embedder } from "@/server/modules/kb/embedder";
import { runIngestJob } from "@/server/modules/kb/ingest-job";
import { IngestError } from "@/server/modules/kb/ingest-errors";
import {
  KB_MAX_DOCUMENTS_PER_WORKSPACE,
  KB_MAX_UPLOAD_BYTES,
  KB_MAX_WORKSPACE_BYTES,
} from "@/server/modules/kb/limits";
import * as kbRepo from "@/server/modules/kb/repository";
import { KB_RATE_LIMITS, kbRateLimitKey, searchKnowledgeBase } from "@/server/modules/kb/service";
import { getAuth } from "@/server/platform/auth";
import { getSessionContext, getWorkspaceContext } from "@/server/platform/auth/context";
import { getDb } from "@/server/platform/db/client";
import { transaction } from "@/server/platform/db/tx";
import { stopWebBoss } from "@/server/platform/jobs/boss";
import { consumeRateLimit } from "@/server/platform/rate-limit";
import { buildPdf } from "../support/pdf";
import { call } from "./support/api";
import { resetDatabase, signUpAndIn, type TestClient } from "./support/client";

/**
 * Knowledge-base API behaviour (FR-K1–K4). The generic rules (401/403, role matrix,
 * cross-tenant 404 on every route, strict response contracts) are generated from the
 * operation registry in api-v1.test.ts; this file covers what is specific to the KB.
 * Ingestion runs in-process with the offline mock embedder (no worker, no network).
 */

let owner: TestClient, agent: TestClient, globexOwner: TestClient, emptyOwner: TestClient;
let acmeId: string, globexId: string;
const embedder = createMockEmbedder();

function file(name: string, content: string | Uint8Array, type = "application/octet-stream"): FormData {
  const fd = new FormData();
  fd.set("file", new File([content as BlobPart], name, { type }));
  return fd;
}

const upload = (as: TestClient, fd: FormData) => call("uploadKbDocument", { as, body: fd });

async function uploadReady(as: TestClient, workspaceId: string, name: string, content: string) {
  const res = await upload(as, file(name, content, "text/markdown"));
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  const outcome = await runIngestJob(
    { workspaceId, documentId: res.json.id },
    { isFinalAttempt: true },
    { embedder },
  );
  expect(outcome.status).toBe("ready");
  return res.json.id as string;
}

const search = (as: TestClient, query: string) => call("searchKb", { as, body: { query } });

async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await getDb().pool.query(text, params)).rows as T[];
}

const jobsFor = (documentId: string) =>
  q(`SELECT id FROM pgboss.job WHERE name = 'kb.ingest' AND data->>'documentId' = $1`, [documentId]);

const REFUNDS = `# Refunds

Refunds are issued to the original payment method within 14 days of the request.

# Sync

If files stop syncing, sign out of the desktop app and sign in again to restart the sync service.`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

beforeAll(async () => {
  await resetDatabase();
  const handler = (req: Request) => getAuth().handler(req);
  owner = await signUpAndIn(handler, "owner@acme.test");
  agent = await signUpAndIn(handler, "agent@acme.test");
  globexOwner = await signUpAndIn(handler, "owner@globex.test");
  emptyOwner = await signUpAndIn(handler, "owner@empty.test");
  acmeId = (await owner.post("/organization/create", { name: "Acme", slug: "acme" })).json.id;
  globexId = (await globexOwner.post("/organization/create", { name: "Globex", slug: "globex" })).json.id;
  await emptyOwner.post("/organization/create", { name: "Empty", slug: "empty" });
  const agentUserId = (await getSessionContext(agent.headers))!.user.id;
  await getAuth().api.addMember({ body: { userId: agentUserId, role: "agent", organizationId: acmeId } });
  await agent.post("/organization/set-active", { organizationId: acmeId });
});

beforeEach(async () => {
  await q(`TRUNCATE kb_chunk, kb_document_blob, kb_document, ai_usage, app_rate_limit`);
  await q(`DELETE FROM pgboss.job`);
});

afterAll(async () => {
  await stopWebBoss();
});

describe("FR-K1 upload", () => {
  it("stores the file as pending, queues one ingestion job in the same transaction, and audits it", async () => {
    const res = await upload(owner, file("Refund_policy.md", REFUNDS, "text/markdown"));
    expect(res.status).toBe(201);
    const doc = KbDocument.parse(res.json); // strict: no hash, no bytes, no workspace id
    expect(doc).toMatchObject({
      title: "Refund policy",
      filename: "Refund_policy.md",
      status: "pending",
      error: null,
    });
    expect(await jobsFor(doc.id)).toHaveLength(1);
    const [audit] = await q<{ action: string; metadata: Record<string, unknown> }>(
      `SELECT action, metadata FROM audit_log WHERE target_id = $1`,
      [doc.id],
    );
    expect(audit).toEqual({
      action: "kb.document_uploaded",
      metadata: { title: "Refund policy", mimeType: "text/markdown", sizeBytes: Buffer.byteLength(REFUNDS) },
    });
  });

  it("decides the type from the name and contents; the browser's Content-Type is ignored", async () => {
    const txt = await upload(owner, file("notes.txt", "plain words", "application/pdf"));
    expect(txt.json.mimeType).toBe("text/plain");
    const pdf = await upload(owner, file("manual.pdf", buildPdf({ pages: [["Hello"]] }), "text/plain"));
    expect(pdf.json.mimeType).toBe("application/pdf");
  });

  it.each([
    ["a PNG renamed to .pdf", "photo.pdf", PNG, "content_mismatch"],
    ["a PDF renamed to .txt", "notes.txt", buildPdf({ pages: [["x"]] }), "content_mismatch"],
    ["an executable", "setup.exe", new Uint8Array([0x4d, 0x5a, 0x90, 0]), "unsupported_type"],
    ["text that is not UTF-8", "latin1.md", new Uint8Array([0x63, 0x61, 0x66, 0xe9]), "not_utf8"],
    ["an empty file", "empty.md", new Uint8Array(), "empty_file"],
    ["a path in the name", "../../etc/passwd:x.md", "text", "invalid_filename"],
  ])("rejects %s with 400 and a reason, storing nothing", async (_label, name, content, reason) => {
    const res = await upload(owner, file(name, content));
    expect(res.status).toBe(400);
    expect(Problem.parse(res.json)).toMatchObject({ reason, errors: { file: [expect.any(String)] } });
    expect(await q(`SELECT 1 FROM kb_document`)).toHaveLength(0);
  });

  it("413 for files over 5 MB, and the body is cut off while streaming", async () => {
    const justOver = await upload(owner, file("big.md", "x".repeat(KB_MAX_UPLOAD_BYTES + 1)));
    expect(justOver.status).toBe(413);
    expect(justOver.json.detail).toBe("Files are limited to 5 MB.");

    let pulled = 0;
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
        if (pulled > 400) controller.close(); // 25 MB if it were read to the end
      },
    });
    const streamed = await call("uploadKbDocument", {
      as: owner,
      raw: stream,
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    expect(streamed.status).toBe(413);
    expect(pulled).toBeLessThan(KB_MAX_UPLOAD_BYTES / chunk.byteLength + 5);
  });

  it("415 for a body that is not multipart, 400 when the file is missing", async () => {
    const json = await call("uploadKbDocument", { as: owner, body: { file: "nope" } });
    expect(json.status).toBe(415);
    const noFile = new FormData();
    noFile.set("file", "just a string");
    const res = await upload(owner, noFile);
    expect(res.status).toBe(400);
    expect(res.json.errors).toEqual({ file: ["Attach a file in the `file` field."] });
  });

  it("the same file twice → 409 pointing at the existing document; another workspace may upload it", async () => {
    const first = await upload(owner, file("a.md", REFUNDS));
    const again = await upload(owner, file("copy-of-a.md", REFUNDS));
    expect(again.status).toBe(409);
    expect(Problem.parse(again.json)).toMatchObject({
      type: "https://supportpilot.dev/problems/duplicate_document",
      existingDocumentId: first.json.id,
    });
    expect((await upload(globexOwner, file("a.md", REFUNDS))).status).toBe(201);
  });

  it(`caps a workspace at ${KB_MAX_DOCUMENTS_PER_WORKSPACE} documents and 50 MB`, async () => {
    for (let i = 0; i < KB_MAX_DOCUMENTS_PER_WORKSPACE - 1; i++) {
      await kbRepo.insertDocument(getDb().db, globexId, {
        title: `D${i}`,
        filename: `d${i}.md`,
        mimeType: "text/markdown",
        sha256: i.toString(16).padStart(64, "0"),
        uploadedBy: null,
        bytes: Buffer.from("x"),
      });
    }
    // Two uploads at once with room for one: the per-workspace lock lets exactly one in.
    const [a, b] = await Promise.all([
      upload(globexOwner, file("last-a.md", "# A")),
      upload(globexOwner, file("last-b.md", "# B")),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.json.type).toMatch(/kb_quota_exceeded$/);
    expect(await q(`SELECT 1 FROM kb_document WHERE workspace_id = $1`, [globexId])).toHaveLength(100);

    await q(`DELETE FROM kb_document WHERE workspace_id = $1 AND title LIKE 'D%' AND title <> 'D0'`, [
      globexId,
    ]);
    await q(`UPDATE kb_document SET size_bytes = $2 WHERE workspace_id = $1 AND title = 'D0'`, [
      globexId,
      KB_MAX_WORKSPACE_BYTES - 10,
    ]);
    const overBytes = await upload(globexOwner, file("eleven-bytes.md", "# 11 bytes!"));
    expect(overBytes.status).toBe(409);
    expect(overBytes.json.detail).toMatch(/50 MB/);
  });

  it("uploads to one workspace wait for each other, so none can slip past the caps", async () => {
    let release!: () => void;
    let lockTaken!: () => void;
    const taken = new Promise<void>((r) => (lockTaken = r));
    const holder = transaction(async (tx) => {
      await kbRepo.lockWorkspaceUploads(tx, acmeId);
      lockTaken();
      await new Promise<void>((r) => (release = r));
    });
    await taken;
    let finished = false;
    const pending = upload(owner, file("waits.md", "# Waits")).then((r) => ((finished = true), r));
    await new Promise((r) => setTimeout(r, 300));
    expect(finished).toBe(false); // blocked on the workspace lock
    expect((await upload(globexOwner, file("other.md", "# Other"))).status).toBe(201); // other workspaces are not
    release();
    await holder;
    expect((await pending).status).toBe(201);
  });

  it("rate limits uploads per user: 429 with Retry-After, nothing stored", async () => {
    const ctx = (await getWorkspaceContext(owner.headers))!;
    for (let i = 0; i < KB_RATE_LIMITS.uploadsPerUser.max; i++) {
      await consumeRateLimit(kbRateLimitKey("kb-upload", ctx), KB_RATE_LIMITS.uploadsPerUser);
    }
    const res = await upload(owner, file("one-more.md", "# More"));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await q(`SELECT 1 FROM kb_document`)).toHaveLength(0);
  });
});

describe("FR-K2 status and passages", () => {
  it("a document goes from pending to ready; its page shows the passages in order", async () => {
    const id = (await upload(owner, file("guide.md", REFUNDS))).json.id;
    expect((await call("getKbDocument", { as: agent, params: { id } })).json.document.status).toBe("pending");

    await runIngestJob({ workspaceId: acmeId, documentId: id }, { isFinalAttempt: true }, { embedder });
    const res = await call("getKbDocument", { as: agent, params: { id } });
    const detail = KbDocumentDetail.parse(res.json);
    expect(detail.document).toMatchObject({
      status: "ready",
      chunkCount: 2,
      embeddingModel: embedder.modelId,
    });
    expect(detail.chunks.map((c) => [c.ordinal, c.headingPath])).toEqual([
      [0, "Refunds"],
      [1, "Sync"],
    ]);

    const list = KbDocumentList.parse((await call("listKbDocuments", { as: agent })).json);
    expect(list.items.map((d) => d.id)).toEqual([id]);
    expect(list.usage).toEqual({
      documentCount: 1,
      totalBytes: Buffer.byteLength(REFUNDS),
      maxDocuments: KB_MAX_DOCUMENTS_PER_WORKSPACE,
      maxBytes: KB_MAX_WORKSPACE_BYTES,
    });
  });

  it("a failed document explains why in plain language, and can be retried once fixed", async () => {
    const id = (await upload(owner, file("locked.pdf", buildPdf({ userPassword: "s3cret" })))).json.id;
    await runIngestJob({ workspaceId: acmeId, documentId: id }, { isFinalAttempt: true }, { embedder });
    const failed = (await call("getKbDocument", { as: owner, params: { id } })).json.document;
    expect(failed.error).toEqual({
      code: "pdf_encrypted",
      message: "The PDF is password-protected. Remove the password and upload it again.",
    });

    const retried = await call("retryKbDocument", { as: owner, params: { id } });
    expect(retried.status).toBe(200);
    expect(KbDocument.parse(retried.json)).toMatchObject({ status: "pending", error: null });
    expect(await jobsFor(id)).toHaveLength(2);
    const [audit] = await q(
      `SELECT metadata FROM audit_log WHERE action = 'kb.document_retried' AND target_id = $1`,
      [id],
    );
    expect(audit!.metadata).toEqual({ title: "locked", previousError: "pdf_encrypted" });
  });

  it("only failed documents with their file still stored can be retried (409 otherwise)", async () => {
    const ready = await uploadReady(owner, acmeId, "ready.md", REFUNDS);
    const res = await call("retryKbDocument", { as: owner, params: { id: ready } });
    expect(res.status).toBe(409);
    expect(res.json.detail).toBe("Only failed documents can be retried (this one is ready).");

    const id = (await upload(owner, file("gone.md", "# Gone"))).json.id;
    await kbRepo.markFailed(getDb().db, acmeId, id, "internal_error");
    await q(`DELETE FROM kb_document_blob WHERE document_id = $1`, [id]);
    const noBytes = await call("retryKbDocument", { as: owner, params: { id } });
    expect(noBytes.status).toBe(409);
    expect(noBytes.json.detail).toBe("The original file is no longer stored. Upload it again.");
    expect((await kbRepo.findDocument(acmeId, id))!.status).toBe("failed");
  });
});

describe("FR-K3 delete", () => {
  it("removes the document and its passages at once: search stops finding it", async () => {
    const id = await uploadReady(owner, acmeId, "refunds.md", REFUNDS);
    expect((await search(owner, "refunds payment method")).json.results.length).toBeGreaterThan(0);

    const res = await call("deleteKbDocument", { as: owner, params: { id } });
    expect(res.status).toBe(204);
    expect(res.json).toBeUndefined();
    expect(await q(`SELECT 1 FROM kb_chunk WHERE document_id = $1`, [id])).toHaveLength(0);
    expect((await search(owner, "refunds payment method")).json.results).toEqual([]);
    expect((await call("getKbDocument", { as: owner, params: { id } })).status).toBe(404);
    expect((await call("deleteKbDocument", { as: owner, params: { id } })).status).toBe(404);

    const [audit] = await q(
      `SELECT metadata FROM audit_log WHERE action = 'kb.document_deleted' AND target_id = $1`,
      [id],
    );
    expect(audit!.metadata).toEqual({ title: "refunds", status: "ready" });
  });
});

describe("FR-K4 test search (hybrid retrieval, D10)", () => {
  it("returns the best passages first, saying which search found each", async () => {
    await uploadReady(owner, acmeId, "help.md", REFUNDS);
    await uploadReady(
      owner,
      acmeId,
      "billing.md",
      "# Invoices\n\nInvoices are emailed on the first of each month.",
    );
    const res = await search(owner, "How long do refunds take?");
    expect(res.status).toBe(200);
    const body = KbSearchResults.parse(res.json);
    expect(body.model).toBe(embedder.modelId);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.length).toBeLessThanOrEqual(5);
    expect(body.results.map((r) => r.rank)).toEqual(body.results.map((_, i) => i + 1));
    expect(body.results[0]).toMatchObject({
      chunk: { headingPath: "Refunds" },
      document: { title: "help" },
      matchedBy: ["vector", "keyword"],
    });
    const scores = body.results.map((r) => r.rrfScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("keyword search uses English stemming: “syncing” finds “sync”", async () => {
    await uploadReady(owner, acmeId, "help.md", REFUNDS);
    const body = KbSearchResults.parse((await search(owner, "syncing")).json);
    const hit = body.results.find((r) => r.chunk.headingPath === "Sync");
    expect(hit?.keyword).not.toBeNull();
  });

  it("identical text in two workspaces: each only ever sees its own", async () => {
    const acmeDoc = await uploadReady(owner, acmeId, "same.md", REFUNDS);
    const globexDoc = await uploadReady(globexOwner, globexId, "same.md", REFUNDS);
    const acme = KbSearchResults.parse((await search(owner, "refunds sync")).json);
    const globex = KbSearchResults.parse((await search(globexOwner, "refunds sync")).json);
    expect(new Set(acme.results.map((r) => r.document.id))).toEqual(new Set([acmeDoc]));
    expect(new Set(globex.results.map((r) => r.document.id))).toEqual(new Set([globexDoc]));
    const globexList = (await call("listKbDocuments", { as: globexOwner })).json.items.map(
      (d: { id: string }) => d.id,
    );
    expect(globexList).toEqual([globexDoc]);
  });

  it("both searches only ever consider the caller's workspace (not just filtered afterwards)", async () => {
    await uploadReady(owner, acmeId, "same.md", REFUNDS);
    await uploadReady(globexOwner, globexId, "same.md", REFUNDS);
    const acmeChunks = (
      await q<{ id: string }>(`SELECT id FROM kb_chunk WHERE workspace_id = $1`, [acmeId])
    ).map((r) => r.id);
    const { embedding } = await embedder.embedQuery("refunds sync");
    const [vector, keyword] = await transaction(async (tx) => [
      await kbRepo.vectorSearch(tx, acmeId, embedding, 8),
      await kbRepo.keywordSearch(tx, acmeId, "refunds sync", 8),
    ]);
    // Another workspace's passages would otherwise use up the 8 candidate slots.
    expect(vector.map((h) => h.chunkId).sort()).toEqual([...acmeChunks].sort());
    expect(keyword.map((h) => h.chunkId).sort()).toEqual([...acmeChunks].sort());
  });

  it("an empty knowledge base returns nothing without calling the AI provider", async () => {
    let calls = 0;
    const spy: Embedder = {
      ...embedder,
      modelId: embedder.modelId,
      embedQuery: async (...args) => (calls++, embedder.embedQuery(...args)),
    };
    const res = await searchKnowledgeBase(emptyOwner.headers, { query: "anything" }, { embedder: spy });
    expect(res).toMatchObject({ model: null, results: [] });
    expect(calls).toBe(0);
    expect(await q(`SELECT 1 FROM ai_usage`)).toHaveLength(0);
  });

  it("records the question's embedding in ai_usage (not the question itself)", async () => {
    await uploadReady(owner, acmeId, "help.md", REFUNDS);
    await q(`TRUNCATE ai_usage`);
    await search(owner, "refunds");
    const rows = await q(`SELECT feature, model, input_tokens FROM ai_usage WHERE workspace_id = $1`, [
      acmeId,
    ]);
    expect(rows).toEqual([{ feature: "embed", model: embedder.modelId, input_tokens: expect.any(Number) }]);
  });

  it("refuses to compare vectors from different embedding models (409)", async () => {
    const id = await uploadReady(owner, acmeId, "help.md", REFUNDS);
    await q(`UPDATE kb_document SET embedding_model = 'other-model@768' WHERE id = $1`, [id]);
    const res = await search(owner, "refunds");
    expect(res.status).toBe(409);
    expect(res.json.type).toMatch(/embedding_model_mismatch$/);
  });

  it("AI provider down → 503 with Retry-After; rejected → 502", async () => {
    await uploadReady(owner, acmeId, "help.md", REFUNDS);
    const failing = (code: "embedding_unavailable" | "embedding_rejected"): Embedder => ({
      ...embedder,
      modelId: embedder.modelId,
      embedQuery: async () => {
        throw new IngestError(code);
      },
    });
    await expect(
      searchKnowledgeBase(
        owner.headers,
        { query: "refunds" },
        { embedder: failing("embedding_unavailable") },
      ),
    ).rejects.toMatchObject({ status: 503, headers: { "retry-after": "30" } });
    await expect(
      searchKnowledgeBase(owner.headers, { query: "refunds" }, { embedder: failing("embedding_rejected") }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("a hung AI provider is cut off by the search deadline → 503 (real Gemini adapter, fake network)", async () => {
    await uploadReady(owner, acmeId, "help.md", REFUNDS);
    let sawSignal = false;
    const hangingFetch: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        sawSignal = init?.signal instanceof AbortSignal;
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    const gemini = createGeminiEmbedder({ apiKey: "test-key", fetch: hangingFetch, maxRetries: 0 });
    // Keep the mock's model id so the documents above still match, but embed through Gemini.
    const viaGemini: Embedder = { ...embedder, embedQuery: (q, signal) => gemini.embedQuery(q, signal) };
    const started = performance.now();
    await expect(
      searchKnowledgeBase(owner.headers, { query: "refunds" }, { embedder: viaGemini, embedTimeoutMs: 100 }),
    ).rejects.toMatchObject({ status: 503, headers: { "retry-after": "30" } });
    expect(sawSignal).toBe(true);
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it("validates the question and rate limits searches per user", async () => {
    expect((await search(owner, "   ")).status).toBe(400);
    expect((await search(owner, "x".repeat(501))).status).toBe(400);
    expect((await call("searchKb", { as: owner, body: { query: "ok", extra: 1 } })).status).toBe(400);

    const ctx = (await getWorkspaceContext(owner.headers))!;
    for (let i = 0; i < KB_RATE_LIMITS.searchesPerUser.max; i++) {
      await consumeRateLimit(kbRateLimitKey("kb-search", ctx), KB_RATE_LIMITS.searchesPerUser);
    }
    const limited = await search(owner, "refunds");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("transaction safety: a failed upload leaves neither a document nor a job", async () => {
    // Force the audit insert to fail after the document and job were written in the transaction.
    await q(
      `ALTER TABLE audit_log ADD CONSTRAINT kb_test_block CHECK (action <> 'kb.document_uploaded') NOT VALID`,
    );
    try {
      const res = await upload(owner, file("rollback.md", "# Rollback"));
      expect(res.status).toBe(500);
    } finally {
      await q(`ALTER TABLE audit_log DROP CONSTRAINT kb_test_block`);
    }
    expect(await q(`SELECT 1 FROM kb_document`)).toHaveLength(0);
    expect(await q(`SELECT 1 FROM pgboss.job WHERE name = 'kb.ingest'`)).toHaveLength(0);
  });
});
