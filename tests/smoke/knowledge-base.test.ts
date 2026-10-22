import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The whole knowledge-base path across both production processes: upload through the built
 * web server, ingestion by the bundled worker (via pg-boss), then hybrid search back through
 * the server. Runs only when SMOKE_DATABASE_URL is set: it writes a throwaway user straight to
 * the database (sign-up would call the external breached-password API, which is on in
 * production), signs in through the real server, and deletes the user and workspace afterwards.
 */
const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
/** The app's public origin (BETTER_AUTH_URL), which browsers send; may differ from BASE_URL. */
const ORIGIN = process.env.SMOKE_ORIGIN ?? new URL(BASE_URL).origin;
const DATABASE_URL = process.env.SMOKE_DATABASE_URL;

describe.skipIf(!DATABASE_URL)("smoke: knowledge base (server + worker)", () => {
  const email = `smoke-kb-${randomUUID()}@example.test`;
  const password = `Smoke-${randomUUID()}`;
  let cookie = "";
  let workspaceId = "";
  let pool: Pool;

  async function send(path: string, init: RequestInit & { json?: unknown } = {}) {
    const headers = new Headers(init.headers);
    headers.set("origin", ORIGIN);
    if (cookie) headers.set("cookie", cookie);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    const res = await fetch(new URL(path, BASE_URL), { ...init, headers, body, redirect: "manual" });
    const setCookies = res.headers.getSetCookie();
    if (setCookies.length) cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
    return res;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    const userId = `smoke-${randomUUID()}`;
    await pool.query(
      `INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, 'Smoke KB', $2, true)`,
      [userId, email],
    );
    await pool.query(
      `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
       VALUES ($1, $2, 'credential', $2, $3, now(), now())`,
      [randomUUID(), userId, await hashPassword(password)],
    );
    expect(
      (await send("/api/auth/sign-in/email", { method: "POST", json: { email, password } })).status,
    ).toBe(200);
    const org = await send("/api/auth/organization/create", {
      method: "POST",
      json: { name: "Smoke KB", slug: `smoke-kb-${randomUUID().slice(0, 8)}` },
    });
    expect(org.status).toBe(200);
    workspaceId = ((await org.json()) as { id: string }).id;
  });

  afterAll(async () => {
    if (workspaceId) await pool.query(`DELETE FROM "organization" WHERE id = $1`, [workspaceId]);
    await pool.query(`DELETE FROM "user" WHERE email = $1`, [email]);
    await pool.end();
  });

  it("upload → worker ingests → search finds it → delete", async () => {
    const form = new FormData();
    const text = "# Refunds\n\nRefunds are paid back to the original card within 5 business days.\n";
    form.set("file", new Blob([text], { type: "text/markdown" }), "refunds.md");
    const upload = await send("/api/v1/kb/documents", { method: "POST", body: form });
    expect(upload.status, await upload.clone().text()).toBe(201);
    const { id, status } = (await upload.json()) as { id: string; status: string };
    expect(status).toBe("pending");

    let doc: { status: string; chunkCount: number; error: unknown } = { status, chunkCount: 0, error: null };
    for (
      const deadline = Date.now() + 45_000;
      Date.now() < deadline && ["pending", "processing"].includes(doc.status);
    ) {
      await new Promise((r) => setTimeout(r, 500));
      doc = ((await (await send(`/api/v1/kb/documents/${id}`)).json()) as { document: typeof doc }).document;
    }
    expect(doc).toMatchObject({ status: "ready", error: null });
    expect(doc.chunkCount).toBeGreaterThan(0);

    const search = await send("/api/v1/kb/search", {
      method: "POST",
      json: { query: "How long do refunds take?" },
    });
    expect(search.status).toBe(200);
    const { results } = (await search.json()) as {
      results: { document: { id: string }; matchedBy: string[] }[];
    };
    expect(results[0]).toMatchObject({ document: { id }, matchedBy: ["vector", "keyword"] });

    expect((await send(`/api/v1/kb/documents/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await send(`/api/v1/kb/documents/${id}`)).status).toBe(404);
  }, 60_000);
});
