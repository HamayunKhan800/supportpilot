import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Validator } from "@seriousme/openapi-schema-validator";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "@/server/api/openapi";
import { operations, type Operation } from "@/server/api/operations";
import { MAX_BODY_BYTES } from "@/server/api/route";
import { Problem } from "@/server/api/schemas";
import { getAuth } from "@/server/platform/auth";
import { getSessionContext } from "@/server/platform/auth/context";
import { resetEnvCache } from "@/server/platform/env";
import * as openapiRoute from "@/app/api/v1/openapi.json/route";
import * as portalTicketsRoute from "@/app/api/v1/portal/[slug]/tickets/route";
import * as trackingRoute from "@/app/api/v1/portal/t/[token]/route";
import * as trackingMessagesRoute from "@/app/api/v1/portal/t/[token]/messages/route";
import * as ticketsRoute from "@/app/api/v1/tickets/route";
import * as ticketRoute from "@/app/api/v1/tickets/[id]/route";
import * as ticketMessagesRoute from "@/app/api/v1/tickets/[id]/messages/route";
import { resetDatabase, signUpAndIn, type TestClient } from "./support/client";

/**
 * /api/v1 end to end through the real route handlers. Several suites are generated from
 * the operation registry, so a new endpoint is automatically held to the same rules
 * (cross-tenant 404, 401/403, strict response contract) — and fails here if it isn't wired.
 */
const ORIGIN = "http://localhost:3000";
type OpId = keyof typeof operations;
type RouteHandler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const handlers: Record<OpId, RouteHandler> = {
  createPortalTicket: portalTicketsRoute.POST,
  getCustomerTicket: trackingRoute.GET,
  addCustomerReply: trackingMessagesRoute.POST,
  listTickets: ticketsRoute.GET,
  getTicket: ticketRoute.GET,
  updateTicket: ticketRoute.PATCH,
  addTicketMessage: ticketMessagesRoute.POST,
  getOpenApi: openapiRoute.GET,
};

interface CallOptions {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  /** Raw body, sent as-is (overrides `body`). */
  raw?: BodyInit;
  as?: TestClient;
  headers?: Record<string, string>;
  /** Omit the same-origin Origin header that a browser would send. */
  noOrigin?: boolean;
}

async function call(id: OpId, opts: CallOptions = {}) {
  const op: Operation = operations[id];
  const params = opts.params ?? {};
  const path = op.path.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(params[k] ?? ""));
  const url = new URL(path, ORIGIN);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

  const headers = new Headers(opts.as?.headers);
  if (op.method !== "GET") {
    if (!opts.noOrigin) headers.set("origin", ORIGIN);
    headers.set("content-type", "application/json");
  }
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers.set(k, v);

  const body = op.method === "GET" ? undefined : (opts.raw ?? JSON.stringify(opts.body ?? {}));
  const req = new Request(url, { method: op.method, headers, body, duplex: "half" } as RequestInit);
  const res = await handlers[id](req, { params: Promise.resolve(params) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : undefined };
}

const form = (over: Record<string, unknown> = {}) => ({
  name: "Casey Customer",
  email: "casey@example.test",
  subject: "Files are not syncing",
  message: "The desktop app stopped syncing yesterday.",
  ...over,
});

/** Valid request bodies per mutating operation (used by the generated suites). */
const sampleBody: Partial<Record<OpId, () => unknown>> = {
  createPortalTicket: () => form(),
  addCustomerReply: () => ({ message: "Any update on this?" }),
  updateTicket: () => ({ version: currentVersion, priority: "high" }),
  addTicketMessage: () => ({ body: "Looking into it now.", internal: true }),
};

let owner: TestClient, admin: TestClient, agent: TestClient, globexOwner: TestClient, newcomer: TestClient;
let ticketId: string, token: string, currentVersion: number;
let ipCounter = 0;
const nextIp = () => ({ "x-forwarded-for": `203.0.113.${++ipCounter}` });

const handler = (req: Request) => getAuth().handler(req);
const sessionOps = (Object.keys(operations) as OpId[]).filter((id) => operations[id].auth === "session");
const paramsFor = (id: OpId): Record<string, string> =>
  operations[id].path.includes("{id}") ? { id: ticketId } : {};

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
  const acmeId = (await owner.post("/organization/create", { name: "Acme Support", slug: "acme" })).json.id;
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
      "addTicketMessage",
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
            : paramsFor(id);
      const res = await call(id, {
        params,
        as: op.auth === "session" ? owner : undefined,
        body: sampleBody[id]?.(),
        headers: nextIp(),
      });
      expect(res.status, `${id}: ${JSON.stringify(res.json)}`).toBe(op.success.status);
      expect(res.headers.get("cache-control"), id).toBe("no-store");
      if (op.success.schema) op.success.schema.parse(res.json);
      if (id === "updateTicket") currentVersion = res.json.version;
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

describe("tenant isolation (NFR-SEC1): other workspaces' tickets are 404", () => {
  const idOps = sessionOps.filter((id) => operations[id].path.includes("{id}"));

  it("covers every ticket-id route", () => {
    expect(idOps.sort()).toEqual(["addTicketMessage", "getTicket", "updateTicket"]);
  });

  it.each(idOps)("%s → 404 for a member of another workspace", async (id) => {
    const res = await call(id, { as: globexOwner, params: { id: ticketId }, body: sampleBody[id]?.() });
    expect(res.status).toBe(404);
    Problem.parse(res.json);
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

describe("authentication and roles", () => {
  it.each(sessionOps)("%s → 401 without a session", async (id) => {
    const res = await call(id, { params: paramsFor(id), body: sampleBody[id]?.() });
    expect(res.status).toBe(401);
  });

  it.each(sessionOps)("%s → 403 for a user with no workspace", async (id) => {
    const res = await call(id, { as: newcomer, params: paramsFor(id), body: sampleBody[id]?.() });
    expect(res.status).toBe(403);
  });

  it.each(sessionOps)("%s works for owner, admin and agent", async (id) => {
    for (const client of [owner, admin, agent]) {
      const res = await call(id, { as: client, params: paramsFor(id), body: sampleBody[id]?.() });
      expect(res.status, `${id}: ${JSON.stringify(res.json)}`).toBe(operations[id].success.status);
      if (id === "updateTicket") currentVersion = res.json.version;
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
