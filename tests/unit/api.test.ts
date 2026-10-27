import { Validator } from "@seriousme/openapi-schema-validator";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildOpenApiDocument } from "@/server/api/openapi";
import { operations, type Operation } from "@/server/api/operations";
import {
  apiRoute,
  assertSameOrigin,
  MAX_BODY_BYTES,
  MULTIPART_ENVELOPE_BYTES,
  readJson,
} from "@/server/api/route";
import { Message, Ticket } from "@/server/api/schemas";
import { KB_MAX_UPLOAD_BYTES } from "@/server/modules/kb/limits";
import { apiMessage, apiTicket } from "@/server/api/serializers";
import type { Message as MessageRow, Ticket as TicketRow } from "@/server/modules/tickets/repository";
import { resetEnvCache } from "@/server/platform/env";
import { AppError } from "@/server/platform/errors";

const saved = { ...process.env };
beforeEach(() => {
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
  process.env.BETTER_AUTH_SECRET = "x".repeat(32);
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.AUTH_TRUSTED_ORIGINS = "https://preview.example.com/";
  resetEnvCache();
});
afterAll(() => {
  process.env = saved;
  resetEnvCache();
});

async function statusOf(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  return err instanceof AppError ? err.status : err;
}

const jsonReq = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    duplex: "half",
  } as RequestInit);

describe("upload size and the AWS Lambda request limit (plan M8 revision 2)", () => {
  it("the largest accepted upload still fits in one Lambda request after base64 encoding", () => {
    // Function URLs base64-encode binary bodies (4/3 larger) and a synchronous request is at
    // most 6 MB. Counted as 6,000,000 bytes, with 64 KB left for headers and the event's JSON.
    const largestBody = KB_MAX_UPLOAD_BYTES + MULTIPART_ENVELOPE_BYTES;
    const encoded = Math.ceil(largestBody / 3) * 4;
    expect(encoded + 64 * 1024).toBeLessThan(6_000_000);
  });
});

describe("readJson", () => {
  it("parses JSON, including a charset parameter", async () => {
    expect(await readJson(jsonReq('{"a":1}', { "content-type": "application/json; charset=utf-8" }))).toEqual(
      { a: 1 },
    );
  });

  it.each(["text/plain", "application/jsonp", "multipart/form-data", ""])(
    "415 for content-type %j",
    async (type) => {
      expect(await statusOf(readJson(jsonReq("{}", { "content-type": type })))).toBe(415);
    },
  );

  it("413 when the declared length is over the limit, before reading", async () => {
    expect(await statusOf(readJson(jsonReq("{}", { "content-length": String(MAX_BODY_BYTES + 1) })))).toBe(
      413,
    );
  });

  it("413 when the streamed body exceeds the limit", async () => {
    expect(await statusOf(readJson(jsonReq("x".repeat(101)), 100))).toBe(413);
  });

  it("accepts a body exactly at the limit", async () => {
    const body = JSON.stringify("x".repeat(98)); // 100 bytes with quotes
    expect(await readJson(jsonReq(body), 100)).toHaveLength(98);
  });

  it("400 for malformed or empty JSON", async () => {
    expect(await statusOf(readJson(jsonReq("{oops")))).toBe(400);
    expect(await statusOf(readJson(jsonReq("")))).toBe(400);
  });
});

describe("assertSameOrigin", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://localhost:3000/x", { method: "POST", headers });
  const cookie = { cookie: "better-auth.session_token=abc" };

  it("allows requests without cookies (nothing to forge)", () => {
    expect(() => assertSameOrigin(req({ origin: "https://evil.example" }))).not.toThrow();
  });

  it("allows the app origin and trusted origins (normalized)", () => {
    expect(() => assertSameOrigin(req({ ...cookie, origin: "http://localhost:3000" }))).not.toThrow();
    expect(() => assertSameOrigin(req({ ...cookie, origin: "https://preview.example.com" }))).not.toThrow();
  });

  it.each([
    ["foreign origin", { origin: "https://evil.example" }],
    ["missing origin", {}],
    ["null origin", { origin: "null" }],
    ["look-alike origin", { origin: "http://localhost:3000.evil.example" }],
    ["cross-site fetch metadata", { origin: "http://localhost:3000", "sec-fetch-site": "cross-site" }],
  ])("403 for %s", (_, headers) => {
    expect(() => assertSameOrigin(req({ ...cookie, ...headers }))).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });
});

describe("apiRoute", () => {
  const op = {
    id: "testOp",
    method: "GET",
    path: "/api/v1/test/{token}",
    summary: "t",
    tag: "Meta",
    auth: "tracking-token",
    params: z.object({ token: z.string().length(3) }),
    query: z.object({ n: z.coerce.number().int().max(5).default(1) }),
    success: { status: 200, description: "ok" },
    errors: [404],
  } as const satisfies Operation;
  const route = apiRoute(op, async ({ params, query }) => ({ token: params.token, n: query.n }));
  const get = (token: string, qs = "") =>
    route(new Request(`http://localhost:3000/api/v1/test/${token}${qs}`), {
      params: Promise.resolve({ token }),
    });

  it("passes parsed params and query, with no-store and no-referrer", async () => {
    const res = await get("abc", "?n=3");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "abc", n: 3 });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("404 for malformed path params, without echoing the secret path", async () => {
    const res = await get("abcdef");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("abcdef");
  });

  it("400 for an invalid query", async () => {
    expect((await get("abc", "?n=9")).status).toBe(400);
  });

  it("session routes keep the path in problem bodies and omit no-referrer", async () => {
    const sessionRoute = apiRoute({ ...op, auth: "session" }, async () => ({}));
    const ok = await sessionRoute(new Request("http://localhost:3000/api/v1/test/abc"), {
      params: Promise.resolve({ token: "abc" }),
    });
    expect(ok.headers.get("referrer-policy")).toBeNull();
    const bad = await sessionRoute(new Request("http://localhost:3000/api/v1/test/x"), {
      params: Promise.resolve({ token: "x" }),
    });
    expect((await bad.json()).instance).toBe("/api/v1/test/x");
  });

  it("runs the gate before the origin, params and body are read, and stops there if it throws", async () => {
    const seen: string[] = [];
    const postOp = {
      ...op,
      method: "POST",
      auth: "session",
      body: z.strictObject({ ok: z.literal(true) }),
    } as const;
    const gated = (allow: boolean) =>
      apiRoute(postOp, async () => (seen.push("handler"), {}), {
        gate: async () => {
          seen.push("gate");
          if (!allow) throw new AppError(404, "not_found", "Not found");
        },
      });
    // Cross-site, bad param and bad body: each would be 403, 404 or 400 without the gate.
    const req = () =>
      new Request("http://localhost:3000/api/v1/test/x", {
        method: "POST",
        headers: { cookie: "a=b", origin: "https://evil.example", "content-type": "application/json" },
        body: "{}",
      });
    const denied = await gated(false)(req(), { params: Promise.resolve({ token: "x" }) });
    expect(denied.status).toBe(404);
    expect(seen).toEqual(["gate"]);
    const allowed = await gated(true)(req(), { params: Promise.resolve({ token: "x" }) });
    expect(allowed.status).toBe(403); // the gate passed, the usual checks still run
    expect(seen).toEqual(["gate", "gate"]);
  });
});

describe("serializers (opt-in fields only, matching the strict schemas)", () => {
  const now = new Date("2026-10-22T10:00:00Z");
  const row = {
    id: "0b6f2c3e-8a4d-4c1e-9f2a-1d2e3f4a5b6c",
    workspaceId: "ws_1",
    number: 7,
    subject: "Sync broken",
    status: "open",
    priority: "normal",
    category: null,
    customerName: "Casey",
    customerEmail: "casey@example.test",
    assigneeId: null,
    accessTokenHash: "SECRET-HASH",
    version: 2,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  } as unknown as TicketRow;

  const roundTrip = <T>(v: T) => JSON.parse(JSON.stringify(v));

  it("never exposes internal columns", () => {
    const out = roundTrip(apiTicket(row));
    expect(Ticket.parse(out)).toBeTruthy();
    expect(JSON.stringify(out)).not.toContain("SECRET-HASH");
    expect(out).not.toHaveProperty("workspaceId");
    expect(out.assignee).toBeNull();
  });

  it("includes the assignee's display name when assigned", () => {
    const out = roundTrip(apiTicket({ ...row, assigneeId: "user_9" } as TicketRow, "Alex Agent"));
    expect(out.assignee).toEqual({ id: "user_9", name: "Alex Agent" });
    expect(roundTrip(apiTicket({ ...row, assigneeId: "user_9" } as TicketRow)).assignee).toEqual({
      id: "user_9",
      name: null,
    });
  });

  it("maps messages", () => {
    const msg = {
      id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      ticketId: row.id,
      workspaceId: "ws_1",
      authorType: "agent",
      authorUserId: "user_9",
      authorName: "Alex Agent",
      body: "On it",
      isInternal: true,
      createdAt: now,
    } as unknown as MessageRow;
    const out = roundTrip(apiMessage(msg));
    expect(Message.parse(out)).toMatchObject({
      internal: true,
      author: { type: "agent", name: "Alex Agent" },
    });
    expect(out).not.toHaveProperty("workspaceId");
  });
});

interface DocOperation {
  operationId: keyof typeof operations;
  security: unknown[];
  requestBody?: { content: Record<string, { schema: { properties: Record<string, unknown> } }> };
  responses: Record<string, { content?: Record<string, unknown> }>;
  "x-required-roles"?: string[];
  description?: string;
}

describe("OpenAPI document", () => {
  const doc = buildOpenApiDocument();
  const ops = () => Object.values(doc.paths).flatMap((p) => Object.values(p) as DocOperation[]);

  it("is valid OpenAPI 3.1", async () => {
    const result = await new Validator().validate(doc as never);
    expect(result.errors ?? []).toEqual([]);
  });

  it("has one operation per registry entry with unique operationIds", () => {
    const ids = Object.values(doc.paths).flatMap((p) =>
      Object.values(p).map((o) => (o as { operationId: string }).operationId),
    );
    expect(ids.sort()).toEqual(Object.keys(operations).sort());
  });

  it("documents request limits after trimming (input mode would hide them)", () => {
    const create = ops().find((o) => o.operationId === "createPortalTicket")!;
    const body = create.requestBody!.content["application/json"]!.schema;
    expect(body.properties.subject).toMatchObject({ type: "string", minLength: 3, maxLength: 200 });
    expect(body.properties.email).toMatchObject({ format: "email", maxLength: 254 });
  });

  it("errors are problem+json and session operations declare the cookie scheme", () => {
    for (const op of ops()) {
      for (const [status, res] of Object.entries(op.responses)) {
        if (Number(status) >= 400)
          expect(Object.keys(res.content ?? {})).toEqual(["application/problem+json"]);
      }
      expect(op.security).toEqual(operations[op.operationId].auth === "session" ? [{ session: [] }] : []);
    }
  });

  const op = (id: keyof typeof operations) => ops().find((o) => o.operationId === id)!;

  it("documents the upload as multipart/form-data with a required file part", () => {
    const body = op("uploadKbDocument").requestBody!;
    expect(Object.keys(body.content)).toEqual(["multipart/form-data"]);
    expect(body.content["multipart/form-data"]!.schema).toMatchObject({
      type: "object",
      required: ["file"],
      properties: { file: { type: "string", contentMediaType: "application/octet-stream" } },
    });
    expect(op("uploadKbDocument").responses).toHaveProperty("413");
    expect(op("uploadKbDocument").responses).toHaveProperty("415");
  });

  it("documents a delete as 204 with no body", () => {
    const res = op("deleteKbDocument").responses;
    expect(res["204"]).toBeDefined();
    expect(res["204"]!.content).toBeUndefined();
    expect(res["200"]).toBeUndefined();
  });

  it("lists the roles each session operation needs, derived from the permission matrix", () => {
    expect(op("listKbDocuments")["x-required-roles"]).toEqual(["owner", "admin", "agent"]);
    expect(op("uploadKbDocument")["x-required-roles"]).toEqual(["owner", "admin"]);
    expect(op("searchKb")["x-required-roles"]).toEqual(["owner", "admin"]);
    expect(op("uploadKbDocument").description).toContain("Roles: owner, admin.");
    for (const o of ops()) {
      if (operations[o.operationId].auth !== "session")
        expect(o["x-required-roles"], o.operationId).toBeUndefined();
    }
  });

  it("contains no $id or $schema keys (OpenAPI addresses components by path)", () => {
    const text = JSON.stringify(doc);
    expect(text).not.toContain('"$id"');
    expect(text).not.toContain('"$schema"');
  });
});
