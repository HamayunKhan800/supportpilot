import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPdf } from "../support/pdf";

/**
 * Black-box check of a running worker (the bundled `.build/worker.mjs`, locally or in the
 * Docker image): put documents in the database, enqueue jobs, and wait for the results.
 * Runs only when SMOKE_DATABASE_URL points at the database that worker uses.
 */
const DATABASE_URL = process.env.SMOKE_DATABASE_URL;

describe.skipIf(!DATABASE_URL)("smoke: background worker", () => {
  let pool: Pool;
  let boss: PgBoss;
  const workspaceId = `smoke-${randomUUID()}`;
  const userId = `smoke-${randomUUID()}`;

  async function enqueueDocument(filename: string, mimeType: string, bytes: Buffer): Promise<string> {
    const sha = createHash("sha256").update(bytes).digest("hex");
    const { rows } = await pool.query(
      `INSERT INTO kb_document (workspace_id, title, filename, mime_type, size_bytes, sha256, uploaded_by)
       VALUES ($1, $2, $2, $3, $4, $5, $6) RETURNING id`,
      [workspaceId, filename, mimeType, bytes.byteLength, sha, userId],
    );
    const id = rows[0].id as string;
    await pool.query("INSERT INTO kb_document_blob (document_id, bytes) VALUES ($1, $2)", [id, bytes]);
    await boss.send("kb.ingest", { workspaceId, documentId: id });
    return id;
  }

  async function waitForFinalStatus(id: string, timeoutMs = 45_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { rows } = await pool.query(
        "SELECT status, error_code, chunk_count, page_count, embedding_model FROM kb_document WHERE id = $1",
        [id],
      );
      if (rows[0] && (rows[0].status === "ready" || rows[0].status === "failed")) return rows[0];
      if (Date.now() > deadline) throw new Error(`document still ${rows[0]?.status} after ${timeoutMs} ms`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    await pool.query(
      "INSERT INTO organization (id, name, slug, created_at) VALUES ($1, 'Smoke', $1, now())",
      [workspaceId],
    );
    await pool.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'Smoke', $1 || '@smoke.test')`, [
      userId,
    ]);
    boss = new PgBoss({
      connectionString: DATABASE_URL,
      schema: "pgboss",
      migrate: false,
      supervise: false,
      schedule: false,
      max: 2,
    });
    await boss.start();
  });

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await pool?.query("DELETE FROM organization WHERE id = $1", [workspaceId]);
    await pool?.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
    await pool?.end();
  });

  it("ingests a Markdown document", async () => {
    const id = await enqueueDocument(
      "guide.md",
      "text/markdown",
      Buffer.from("# Setup\n\nInstall the app.\n\n# Billing\n\nPay monthly."),
    );
    expect(await waitForFinalStatus(id)).toMatchObject({ status: "ready", chunk_count: 2, error_code: null });
  }, 60_000);

  it("ingests a PDF through the bundled PDF thread", async () => {
    const id = await enqueueDocument(
      "manual.pdf",
      "application/pdf",
      buildPdf({ pages: [["Page one."], ["Page two."]] }),
    );
    expect(await waitForFinalStatus(id)).toMatchObject({ status: "ready", page_count: 2, chunk_count: 2 });
  }, 60_000);

  it("rejects a password-protected PDF with a clear reason", async () => {
    const id = await enqueueDocument("locked.pdf", "application/pdf", buildPdf({ userPassword: "s3cret" }));
    expect(await waitForFinalStatus(id)).toMatchObject({ status: "failed", error_code: "pdf_encrypted" });
  }, 60_000);
});
