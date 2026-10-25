import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Validator } from "@seriousme/openapi-schema-validator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "@/server/api/openapi";
import { operations, type Operation } from "@/server/api/operations";
import { MAX_BODY_BYTES } from "@/server/api/route";
import { Problem } from "@/server/api/schemas";
import * as draftRepo from "@/server/modules/drafts/repository";
import * as kbRepo from "@/server/modules/kb/repository";
import * as settingsRepo from "@/server/modules/settings/repository";
import { insertTriageRun } from "@/server/modules/triage/repository";
import { getAuth } from "@/server/platform/auth";
import { getSessionContext } from "@/server/platform/auth/context";
import { can, ROLES } from "@/server/platform/auth/permissions";
import { getDb } from "@/server/platform/db/client";
import { transaction } from "@/server/platform/db/tx";
import { resetEnvCache } from "@/server/platform/env";
import { stopWebBoss } from "@/server/platform/jobs/boss";
import { call, handlers, type CallOptions, type OpId } from "./support/api";
import { resetDatabase, signUpAndIn, type TestClient } from "./support/client";

/**
 * /api/v1 end to end through the real route handlers. Several suites are generated from
 * the operation registry, so a new endpoint is automatically held to the same rules
 * (cross-tenant 404, 401/403, strict response contract) — and fails here if it isn't wired.
 */
const form = (over: Record<string, unknown> = {}) => ({
  name: "Casey Customer",
  email: "casey@example.test",
  subject: "Files are not syncing",
  message: "The desktop app stopped syncing yesterday.",
  ...over,
});

let uploadCounter = 0;
/** A small, unique Markdown file (unique so it is never a duplicate). */
function sampleUpload(name = "refunds.md", content?: string): FormData {
  const fd = new FormData();
  const text = content ?? `# Refunds\n\nRefunds are issued within 14 days. Sample ${++uploadCounter}.`;
  fd.set("file", new File([text], name, { type: "text/markdown" }));
  return fd;
}

/** Valid request bodies per mutating operation (used by the generated suites). */
const sampleBody: Partial<Record<OpId, () => unknown>> = {
  createPortalTicket: () => form(),
  addCustomerReply: () => ({ message: "Any update on this?" }),
  updateTicket: () => ({ version: currentVersion, priority: "high" }),
  acceptTriageSuggestion: () => ({ version: currentVersion }),
  addTicketMessage: () => ({ body: "Looking into it now.", internal: true }),
  uploadKbDocument: () => sampleUpload(),
  searchKb: () => ({ query: "How long do refunds take?" }),
  sendDraft: () => ({ body: "Refunds take 5 to 10 business days [1]." }),
  rateDraft: () => ({ rating: "up" }),
  updateAiSettings: () => ({ version: settingsVersion, monthlyTokenBudget: 2_000_000 }),
};

let owner: TestClient, admin: TestClient, agent: TestClient, globexOwner: TestClient, newcomer: TestClient;
let ticketId: string, token: string, currentVersion: number;
/** The Acme workspace's settings version (a new workspace starts at 1). */
let settingsVersion = 1;
let acmeId: string, kbDocId: string, draftId: string, ownerId: string;
let ipCounter = 0;
const nextIp = () => ({ "x-forwarded-for": `203.0.113.${++ipCounter}` });

const handler = (req: Request) => getAuth().handler(req);
const sessionOps = (Object.keys(operations) as OpId[]).filter((id) => operations[id].auth === "session");

/** A knowledge document inserted directly (no ingestion job), optionally already failed. */
async function newKbDocument(status: "pending" | "failed" = "pending"): Promise<string> {
  return transaction(async (tx) => {
    const n = ++uploadCounter;
    const doc = await kbRepo.insertDocument(tx, acmeId, {
      title: `Fixture ${n}`,
      filename: `fixture-${n}.md`,
      mimeType: "text/markdown",
      sha256: n.toString(16).padStart(64, "0"),
      uploadedBy: null,
      bytes: Buffer.from(`# Fixture ${n}`),
    });
    if (status === "failed") await kbRepo.markFailed(tx, acmeId, doc.id, "embedding_unavailable");
    return doc.id;
  });
}

/** A finished draft inserted directly (no model call), ready to send or discard. */
async function newReadyDraft(): Promise<string> {
  const db = getDb().db;
  const id = await draftRepo.insertDraft(db, acmeId, {
    ticketId,
    requestedBy: ownerId,
    promptVersion: "draft.v1",
  });
  await draftRepo.finishDraft(db, acmeId, id, {
    status: "ready",
    body: "Refunds take 5 to 10 business days [1].",
  });
  return id;
}

/** An existing resource of the Acme workspace that the operation's {id} can point at. */
const existingIdFor = (id: OpId) =>
  operations[id].tag === "Knowledge" ? kbDocId : operations[id].tag === "Drafts" ? draftId : ticketId;

/**
 * Path params for a call that is expected to succeed. Operations that use up their
 * target (delete, retry) get a fresh document each time.
 */
async function paramsFor(id: OpId): Promise<Record<string, string>> {
  if (!operations[id].path.includes("{id}")) return {};
  if (id === "deleteKbDocument") return { id: await newKbDocument() };
  if (id === "retryKbDocument") return { id: await newKbDocument("failed") };
  if (id === "sendDraft" || id === "discardDraft") return { id: await newReadyDraft() };
  return { id: existingIdFor(id) };
}

async function freshTicket() {
  const created = await call("createPortalTicket", {
    params: { slug: "acme" },
    body: form(),
    headers: nextIp(),
  });
  expect(created.status).toBe(201);
  const t = new URL(created.json.trackingUrl).pathname.split("/").pop()!;
  const list = await call("listTickets", { as: owner, query: { sort: "newest", limit: "1" } });
  return { token: t, ticket: list.json.items[0] };
}

beforeAll(async () => {
  process.env.TRUST_PROXY_HEADERS = "true"; // lets each test pick its client IP
  resetEnvCache();
  await resetDatabase();
  owner = await signUpAndIn(handler, "owner@acme.test");
  admin = await signUpAndIn(handler, "admin@acme.test");
  agent = await signUpAndIn(handler, "agent@acme.test");
  globexOwner = await signUpAndIn(handler, "owner@globex.test");
  newcomer = await signUpAndIn(handler, "newcomer@example.test");
  acmeId = (await owner.post("/organization/create", { name: "Acme Support", slug: "acme" })).json.id;
  await globexOwner.post("/organization/create", { name: "Globex", slug: "globex" });
  for (const [client, role] of [
    [admin, "admin"],
    [agent, "agent"],
  ] as const) {
    const userId = (await getSessionContext(client.headers))!.user.id;
    await getAuth().api.addMember({ body: { userId, role, organizationId: acmeId } });
    await client.post("/organization/set-active", { organizationId: acmeId });
  }
  const first = await freshTicket();
  ticketId = first.ticket.id;
  token = first.token;
  currentVersion = first.ticket.version;
  // A triage result to accept (no worker runs here; the job itself is tested in triage-job).
  await transaction((tx) =>
    insertTriageRun(tx, acmeId, ticketId, {
      status: "succeeded",
      model: "mock-llm",
      promptVersion: "triage.v1",
      category: "bug",
      priority: "urgent",
      sentiment: "negative",
      language: "en",
      confidence: 0.5,
      reason: "Sync stopped working.",
      needsReview: true,
    }),
  );
  kbDocId = await newKbDocument();
  ownerId = (await getSessionContext(owner.headers))!.user.id;
  draftId = await newReadyDraft();
});

afterAll(async () => {
  await stopWebBoss(); // uploads start the web process's enqueue-only job client
});

describe("OpenAPI document", () => {
  it("is a valid OpenAPI 3.1 document", async () => {
    const result = await new Validator().validate(buildOpenApiDocument() as never);
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("is served at /api/v1/openapi.json", async () => {
    const res = await call("getOpenApi");
    expect(res.status).toBe(200);
    expect(res.json).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument())));
  });

  it("documents exactly the routes that exist (no undocumented or phantom endpoints)", () => {
    const root = join(process.cwd(), "src/app/api/v1");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name === "route.ts") files.push(relative(root, dir).split(sep).join("/"));
      }
    };
    walk(root);
    const fromFiles = files.map((d) => "/api/v1/" + d.replace(/\[(\w+)\]/g, "{$1}")).sort();
    const fromRegistry = [...new Set(Object.values(operations).map((o) => o.path))].sort();
    expect(fromFiles).toEqual(fromRegistry);
  });

  it("has a test handler and a sample body for every operation", () => {
    for (const [id, op] of Object.entries(operations) as [OpId, Operation][]) {
      expect(handlers[id], id).toBeTypeOf("function");
      if (op.body) expect(sampleBody[id], `sample body for ${id}`).toBeDefined();
    }
  });
});

describe("response contract (strict schemas: unexpected fields fail)", () => {
  it("every operation's success response matches its documented schema", async () => {
    const order: OpId[] = [
      "createPortalTicket",
      "getCustomerTicket",
      "addCustomerReply",
      "listTickets",
      "getTicket",
      "updateTicket",
      "acceptTriageSuggestion",
      "generateDraft",
      "sendDraft",
      "discardDraft",
      "rateDraft",
      "addTicketMessage",
      "uploadKbDocument",
      "listKbDocuments",
      "getKbDocument",
      "retryKbDocument",
      "searchKb",
      "deleteKbDocument",
      "getAiSettings",
      "updateAiSettings",
      "getOpenApi",
    ];
    expect([...order].sort()).toEqual(Object.keys(operations).sort());
    for (const id of order) {
      const op: Operation = operations[id];
      const params =
        op.auth === "tracking-token"
          ? { token }
          : id === "createPortalTicket"
            ? { slug: "acme" }
            : await paramsFor(id);
      const res = await call(id, {
        params,
        as: op.auth === "session" ? owner : undefined,
        body: sampleBody[id]?.(),
        headers: nextIp(),
      });
      expect(res.status, `${id}: ${JSON.stringify(res.json)}`).toBe(op.success.status);
      expect(res.headers.get("cache-control"), id).toBe("no-store");
      if (op.success.contentType === "application/x-ndjson") {
        expect(res.events.length, id).toBeGreaterThan(0);
        for (const event of res.events) op.success.schema!.parse(event);
      } else if (op.success.schema) op.success.schema.parse(res.json);
      if (id === "updateTicket" || id === "acceptTriageSuggestion") currentVersion = res.json.version;
      if (id === "updateAiSettings") settingsVersion = res.json.settings.version;
    }
  });

  it("tracking-token responses send no Referer and never expose internal data", async () => {
    await call("addTicketMessage", {
      as: owner,
      params: { id: ticketId },
      body: { body: "SECRET-NOTE", internal: true },
    });
    const res = await call("getCustomerTicket", { params: { token } });
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(JSON.stringify(res.json)).not.toContain("SECRET-NOTE");
    expect(JSON.stringify(res.json)).not.toContain("casey@example.test");
  });

  it("portal creation returns a tracking URL on the app origin", async () => {
    const res = await call("createPortalTicket", {
      params: { slug: "acme" },
      body: form(),
      headers: nextIp(),
    });
    expect(res.json.trackingUrl).toMatch(/^http:\/\/localhost:3000\/t\/[A-Za-z0-9_-]{43}$/);
  });
});

describe("errors are RFC 9457 Problem Details", () => {
  it("400 lists the invalid fields", async () => {
    const res = await call("createPortalTicket", {
      params: { slug: "acme" },
      body: form({ email: "nope", subject: "" }),
      headers: nextIp(),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const problem = Problem.parse(res.json);
    expect(Object.keys(problem.errors ?? {})).toEqual(expect.arrayContaining(["email", "subject"]));
  });

  it("unknown portal and unknown tracking token are 404, without echoing the token", async () => {
    expect(
      (await call("createPortalTicket", { params: { slug: "nobody" }, body: form(), headers: nextIp() }))
        .status,
    ).toBe(404);
    const bogus = "A".repeat(43);
    const res = await call("getCustomerTicket", { params: { token: bogus } });
    expect(res.status).toBe(404);
    Problem.parse(res.json);
    expect(JSON.stringify(res.json)).not.toContain(bogus);
  });

  it("invalid query parameters are 400, not ignored", async () => {
    const res = await call("listTickets", { as: owner, query: { status: "open,bogus" } });
    expect(res.status).toBe(400);
  });

  it("a valid comma-separated status filter works (the 400 above is for the bad value only)", async () => {
    // Finding #84: the route validated the query and the service parsed it again, so the
    // already-split array failed the second parse and every status filter returned 400.
    const all = await call("listTickets", { as: owner, query: { limit: "100" } });
    expect(all.status).toBe(200);
    const openOnes = all.json.items.filter((t: { status: string }) => t.status === "open");
    expect(openOnes.length).toBeGreaterThan(0);

    const res = await call("listTickets", { as: owner, query: { status: "open,pending", limit: "100" } });
    expect(res.status).toBe(200);
    expect(res.json.items.length).toBeGreaterThanOrEqual(openOnes.length);
    for (const t of res.json.items) expect(["open", "pending"]).toContain(t.status);

    const none = await call("listTickets", { as: owner, query: { status: "closed" } });
    expect(none.status).toBe(200);
    for (const t of none.json.items) expect(t.status).toBe("closed");
  });

  it("stale version is 409", async () => {
    expect(currentVersion).toBeGreaterThan(1); // the contract test above already updated it
    const stale = { version: currentVersion - 1, priority: "low" };
    const res = await call("updateTicket", { as: owner, params: { id: ticketId }, body: stale });
    expect(res.status).toBe(409);
    expect(
      (await call("updateTicket", { as: owner, params: { id: ticketId }, body: { version: 0 } })).status,
    ).toBe(400);
  });
});

describe("tenant isolation (NFR-SEC1): other workspaces' resources are 404", () => {
  const idOps = sessionOps.filter((id) => operations[id].path.includes("{id}"));

  it("covers every id route", () => {
    expect(idOps.sort()).toEqual([
      "acceptTriageSuggestion",
      "addTicketMessage",
      "deleteKbDocument",
      "discardDraft",
      "generateDraft",
      "getKbDocument",
      "getTicket",
      "rateDraft",
      "retryKbDocument",
      "sendDraft",
      "updateTicket",
    ]);
  });

  it.each(idOps)("%s → 404 for a member of another workspace", async (id) => {
    const target =
      id === "retryKbDocument"
        ? await newKbDocument("failed")
        : operations[id].tag === "Drafts"
          ? await newReadyDraft()
          : existingIdFor(id);
    const res = await call(id, { as: globexOwner, params: { id: target }, body: sampleBody[id]?.() });
    expect(res.status).toBe(404);
    Problem.parse(res.json);
    // ...and nothing happened to it.
    if (operations[id].tag === "Knowledge") {
      expect((await kbRepo.findDocument(acmeId, target))?.status).toBe(
        id === "retryKbDocument" ? "failed" : "pending",
      );
    }
    if (operations[id].tag === "Drafts") {
      const row = (await draftRepo.findDraft(getDb().db, acmeId, target))!.draft;
      expect(row).toMatchObject({ status: "ready", feedback: null, sentMessageId: null });
    }
  });

  it.each(idOps)("%s → 404 for a malformed id (never a database error)", async (id) => {
    const res = await call(id, { as: owner, params: { id: "not-a-uuid'--" }, body: sampleBody[id]?.() });
    expect(res.status).toBe(404);
  });

  it("listTickets never returns another workspace's tickets", async () => {
    const res = await call("listTickets", { as: globexOwner });
    expect(res.status).toBe(200);
    expect(res.json.items).toEqual([]);
  });
});

describe("authentication and roles (docs/01 §2.1 permission matrix)", () => {
  it.each(sessionOps)("%s → 401 without a session", async (id) => {
    const res = await call(id, { params: await paramsFor(id), body: sampleBody[id]?.() });
    expect(res.status).toBe(401);
  });

  it.each(sessionOps)("%s → 403 for a user with no workspace", async (id) => {
    const res = await call(id, { as: newcomer, params: await paramsFor(id), body: sampleBody[id]?.() });
    expect(res.status).toBe(403);
  });

  it("every session operation declares the permission it needs", () => {
    for (const id of sessionOps) expect(operations[id].permission, id).toBeDefined();
  });

  it("agents can read the AI settings but only admins and owners change them", () => {
    expect(can("agent", operations.getAiSettings.permission!)).toBe(true);
    expect(ROLES.filter((r) => can(r, operations.updateAiSettings.permission!)).sort()).toEqual([
      "admin",
      "owner",
    ]);
  });

  it("agents can read the knowledge base but not change or test-search it", () => {
    const allowed = sessionOps.filter(
      (id) => operations[id].tag === "Knowledge" && can("agent", operations[id].permission!),
    );
    expect(allowed.sort()).toEqual(["getKbDocument", "listKbDocuments"]);
  });

  it.each(sessionOps)("%s: each role gets exactly what its permission allows", async (id) => {
    const clients = { owner, admin, agent };
    expect(Object.keys(clients).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES) {
      const params = await paramsFor(id);
      const res = await call(id, { as: clients[role], params, body: sampleBody[id]?.() });
      const expected = can(role, operations[id].permission!) ? operations[id].success.status : 403;
      expect(res.status, `${id} as ${role}: ${JSON.stringify(res.json)}`).toBe(expected);
      if ((id === "updateTicket" || id === "acceptTriageSuggestion") && res.status === 200) {
        currentVersion = res.json.version;
      }
      if (id === "updateAiSettings" && res.status === 200) settingsVersion = res.json.settings.version;
      // A refused change really changed nothing.
      if (res.status === 403 && params.id && operations[id].tag === "Knowledge") {
        expect(await kbRepo.findDocument(acmeId, params.id)).not.toBeNull();
      }
    }
  });
});

describe("request hygiene", () => {
  const patch = (opts: CallOptions) =>
    call("updateTicket", { as: owner, params: { id: ticketId }, body: sampleBody.updateTicket!(), ...opts });

  it("rejects cookie-authenticated writes from another origin (CSRF)", async () => {
    expect((await patch({ headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await patch({ noOrigin: true })).status).toBe(403);
    expect((await patch({ headers: { origin: "null" } })).status).toBe(403);
    expect((await patch({ headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
  });

  const sessionWrites = sessionOps.filter((id) => operations[id].method !== "GET");

  it.each(sessionWrites)("%s: a cross-site request is refused before anything changes", async (id) => {
    const params = await paramsFor(id);
    const before =
      params.id && operations[id].tag === "Knowledge" ? await kbRepo.findDocument(acmeId, params.id) : null;
    const settingsBefore = await settingsRepo.findSettings(getDb().db, acmeId);
    const res = await call(id, {
      as: owner,
      params,
      body: sampleBody[id]?.(),
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    if (before) expect(await kbRepo.findDocument(acmeId, params.id!)).toEqual(before);
    expect(await settingsRepo.findSettings(getDb().db, acmeId)).toEqual(settingsBefore);
  });

  it("allows the same origin", async () => {
    const res = await patch({ headers: { "sec-fetch-site": "same-origin" } });
    expect(res.status).toBe(200);
    currentVersion = res.json.version;
  });

  it("public portal writes need no Origin (no credentials to forge)", async () => {
    const res = await call("createPortalTicket", {
      params: { slug: "acme" },
      body: form(),
      noOrigin: true,
      headers: nextIp(),
    });
    expect(res.status).toBe(201);
  });

  it("415 for non-JSON bodies", async () => {
    const res = await call("addCustomerReply", {
      params: { token },
      raw: "message=hello+there",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(415);
  });

  it("removes NUL characters instead of failing with 500 (M7-19)", async () => {
    const search = await call("listTickets", { as: owner, query: { q: "refund\u0000" } });
    expect(search.status).toBe(200);
    const key = await call("listTickets", { as: owner, query: { "q\u0000": "x", limit: "1" } });
    expect(key.status).toBe(200);
  });

  it("400 for malformed JSON", async () => {
    const res = await call("addCustomerReply", { params: { token }, raw: '{"message": ' });
    expect(res.status).toBe(400);
    expect(res.json.detail).toMatch(/not valid JSON/);
  });

  it("413 for bodies over the limit, declared or streamed", async () => {
    const big = JSON.stringify({ message: "x".repeat(MAX_BODY_BYTES) });
    const declared = await call("addCustomerReply", { params: { token }, raw: big });
    expect(declared.status).toBe(413);

    // A chunked body with no Content-Length is cut off while streaming, not buffered whole.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new TextEncoder().encode("x".repeat(16 * 1024)));
        if (pulled > 100) controller.close();
      },
    });
    const streamed = await call("addCustomerReply", { params: { token }, raw: stream });
    expect(streamed.status).toBe(413);
    expect(pulled).toBeLessThan(10);
  });

  it("429 carries Retry-After", async () => {
    const ip = { "x-forwarded-for": "192.0.2.250" };
    let res;
    for (let i = 0; i < 6; i++) {
      res = await call("createPortalTicket", { params: { slug: "acme" }, body: form(), headers: ip });
    }
    expect(res!.status).toBe(429);
    expect(Number(res!.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
