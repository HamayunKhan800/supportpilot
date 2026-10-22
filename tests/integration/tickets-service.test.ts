import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { getAuth } from "@/server/platform/auth";
import { listAuditEvents } from "@/server/platform/auth/audit";
import { getSessionContext } from "@/server/platform/auth/context";
import { getDb } from "@/server/platform/db/client";
import { ticket } from "@/server/platform/db/schema";
import { resetEnvCache } from "@/server/platform/env";
import { AppError } from "@/server/platform/errors";
import { consumeRateLimit } from "@/server/platform/rate-limit";
import {
  addAgentMessage,
  addCustomerReply,
  createPortalTicket,
  getCustomerTicket,
  getInboxOptions,
  getPortal,
  getTicketByNumberForAgent,
  getTicketCounts,
  getTicketForAgent,
  listTicketsForAgent,
  updateTicketForAgent,
} from "@/server/modules/tickets/service";
import { generateTrackingToken } from "@/server/modules/tickets/tracking-token";
import { resetDatabase, signUpAndIn, type TestClient } from "./support/client";

const handler = (req: Request) => getAuth().handler(req);

let owner: TestClient, admin: TestClient, agent: TestClient, globexOwner: TestClient, newcomer: TestClient;
let acmeId: string, agentId: string, globexOwnerId: string;

/** Each submission gets its own IP so per-IP limits only apply where a test wants them. */
let ipCounter = 0;
const nextIp = () => `198.51.100.${++ipCounter}`;

const form = (over: Record<string, unknown> = {}) => ({
  name: "Casey Customer",
  email: "casey@example.test",
  subject: "Files are not syncing",
  message: "The desktop app stopped syncing yesterday.",
  ...over,
});

async function submit(over: Record<string, unknown> = {}, slug = "acme") {
  const { token } = await createPortalTicket(slug, form(over), nextIp());
  const view = await getCustomerTicket(token);
  const detail = await getTicketByNumberForAgent(owner.headers, view.number);
  return { token, ticket: detail.ticket };
}

async function expectAppError(p: Promise<unknown>, status: number) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(status);
}

beforeAll(async () => {
  await resetDatabase();
  owner = await signUpAndIn(handler, "owner@acme.test");
  admin = await signUpAndIn(handler, "admin@acme.test");
  agent = await signUpAndIn(handler, "agent@acme.test");
  globexOwner = await signUpAndIn(handler, "owner@globex.test");
  newcomer = await signUpAndIn(handler, "newcomer@example.test");
  acmeId = (await owner.post("/organization/create", { name: "Acme Support", slug: "acme" })).json.id;
  await globexOwner.post("/organization/create", { name: "Globex", slug: "globex" });
  agentId = (await getSessionContext(agent.headers))!.user.id;
  globexOwnerId = (await getSessionContext(globexOwner.headers))!.user.id;
  const adminId = (await getSessionContext(admin.headers))!.user.id;
  for (const [userId, role] of [
    [adminId, "admin"],
    [agentId, "agent"],
  ] as const) {
    await getAuth().api.addMember({ body: { userId, role, organizationId: acmeId } });
  }
  for (const c of [admin, agent]) await c.post("/organization/set-active", { organizationId: acmeId });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("FR-T1 portal ticket submission", () => {
  it("shows the portal for a known workspace only", async () => {
    expect(await getPortal("acme")).toEqual({ name: "Acme Support", slug: "acme" });
    await expectAppError(getPortal("no-such-workspace"), 404);
  });

  it("creates a numbered ticket with the first message and returns the token once", async () => {
    const { token, ticket: t } = await submit({ subject: "Created via portal" });
    expect(t).toMatchObject({
      subject: "Created via portal",
      status: "open",
      customerEmail: "casey@example.test",
    });
    expect(t.number).toBeGreaterThan(0);

    // Only the hash is stored: the raw token appears nowhere in the row.
    const { pool } = getDb();
    const { rows } = await pool.query(`SELECT row_to_json(t)::text AS j FROM ticket t WHERE id = $1`, [t.id]);
    expect(rows[0].j).not.toContain(token);

    const audit = await listAuditEvents(getDb().db, acmeId, { limit: 100 });
    const created = audit.entries.find((e) => e.action === "ticket.created" && e.targetId === t.id);
    expect(created).toMatchObject({
      actorType: "customer",
      actorUserId: null,
      metadata: { number: t.number },
    });
    expect(JSON.stringify(created!.metadata)).not.toContain("casey@example.test"); // no PII in audit
  });

  it("rejects invalid input and unknown workspaces", async () => {
    await expect(createPortalTicket("acme", form({ email: "nope" }), nextIp())).rejects.toBeInstanceOf(
      ZodError,
    );
    await expectAppError(createPortalTicket("no-such-workspace", form(), nextIp()), 404);
  });

  it("accepts a message containing a NUL byte instead of failing with a 500", async () => {
    const { token } = await createPortalTicket(
      "acme",
      form({ message: "Broken\u0000 upload again" }),
      nextIp(),
    );
    const view = await getCustomerTicket(token);
    expect(view.messages[0]!.body).toBe("Broken upload again");
  });

  it("silently drops honeypot submissions", async () => {
    const before = await getTicketCounts(owner.headers);
    const { token } = await createPortalTicket("acme", form({ website: "http://spam.example" }), nextIp());
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // looks normal to a bot
    expect(await getTicketCounts(owner.headers)).toEqual(before);
    await expectAppError(getCustomerTicket(token), 404);
  });

  it("limits submissions per IP and workspace (T7)", async () => {
    const ip = "203.0.113.50";
    for (let i = 0; i < 5; i++) await createPortalTicket("acme", form(), ip);
    await expectAppError(createPortalTicket("acme", form(), ip), 429);
    // Same IP, different workspace: separate bucket. Different IP: unaffected.
    await createPortalTicket("globex", form(), ip);
    await createPortalTicket("acme", form(), nextIp());
  });

  it("can be switched off for the E2E server only", async () => {
    vi.stubEnv("PORTAL_RATE_LIMIT_ENABLED", "false");
    resetEnvCache();
    const ip = "203.0.113.60";
    for (let i = 0; i < 7; i++) await createPortalTicket("globex", form(), ip);
  });
});

describe("fixed-window limiter (database)", () => {
  it("allows max requests per window, then resets in the next window", async () => {
    const rule = { windowSeconds: 60, max: 2 };
    const t0 = new Date("2026-03-01T10:00:05Z");
    expect((await consumeRateLimit("test:a", rule, t0)).allowed).toBe(true);
    expect((await consumeRateLimit("test:a", rule, t0)).remaining).toBe(0);
    const denied = await consumeRateLimit("test:a", rule, t0);
    expect(denied).toMatchObject({ allowed: false, retryAfterSeconds: 55 });
    expect((await consumeRateLimit("test:a", rule, new Date("2026-03-01T10:01:00Z"))).allowed).toBe(true);
  });

  it("counts correctly under concurrency", async () => {
    const rule = { windowSeconds: 60, max: 10 };
    const now = new Date("2026-03-01T11:00:00Z");
    const results = await Promise.all(
      Array.from({ length: 25 }, () => consumeRateLimit("test:b", rule, now)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });
});

describe("FR-T2 customer view and replies", () => {
  it("never shows internal notes, assignees or internal ids", async () => {
    const { token, ticket: t } = await submit();
    await addAgentMessage(agent.headers, t.id, {
      body: "Internal: customer is on legacy plan",
      internal: true,
    });
    await addAgentMessage(agent.headers, t.id, { body: "We're on it!", internal: false });

    const view = await getCustomerTicket(token);
    expect(view.messages.map((m) => m.body)).toEqual([
      "The desktop app stopped syncing yesterday.",
      "We're on it!",
    ]);
    expect(view.messages.map((m) => m.from)).toEqual(["customer", "support"]);
    expect(view.messages[1]!.authorName).toBe("agent");
    const json = JSON.stringify(view);
    expect(json).not.toContain("legacy plan");
    expect(json).not.toContain(t.id);
    expect(json).not.toContain(acmeId);
    expect(view).not.toHaveProperty("assigneeId");
    expect(view).not.toHaveProperty("customerEmail");
  });

  it("returns 404 for malformed and unknown tokens", async () => {
    await expectAppError(getCustomerTicket("not-a-token"), 404);
    await expectAppError(getCustomerTicket(generateTrackingToken().token), 404);
  });

  it("reopens a pending ticket on reply and audits it as the customer (D2)", async () => {
    const { token, ticket: t } = await submit();
    await updateTicketForAgent(agent.headers, t.id, { version: t.version, status: "pending" });
    await addCustomerReply(token, { message: "Still broken, sorry!" });

    const after = (await getTicketForAgent(agent.headers, t.id)).ticket;
    expect(after.status).toBe("open");
    expect(after.version).toBe(t.version + 2); // agent edit + reopen: stale edits now get 409
    const audit = await listAuditEvents(getDb().db, acmeId, { limit: 200 });
    expect(
      audit.entries.find(
        (e) => e.targetId === t.id && e.actorType === "customer" && e.action === "ticket.status_changed",
      ),
    ).toMatchObject({ metadata: { from: "pending", to: "open", reason: "customer_reply" } });
  });

  it("refuses replies on closed tickets", async () => {
    const { token, ticket: t } = await submit();
    await updateTicketForAgent(agent.headers, t.id, { version: t.version, status: "closed" });
    await expectAppError(addCustomerReply(token, { message: "Hello?" }), 409);
    expect((await getCustomerTicket(token)).canReply).toBe(false);
  });

  it("limits replies per ticket", async () => {
    const { token } = await submit();
    for (let i = 0; i < 10; i++) await addCustomerReply(token, { message: `Reply ${i}` });
    await expectAppError(addCustomerReply(token, { message: "One more" }), 429);
  });
});

describe("FR-T3 agent queue", () => {
  it("filters by assignee 'me' and searches", async () => {
    const { ticket: t } = await submit({ subject: "Quokka-unique subject" });
    await updateTicketForAgent(owner.headers, t.id, { version: t.version, assigneeId: agentId });
    const mine = await listTicketsForAgent(agent.headers, { assignee: "me" });
    expect(mine.items.map((i) => i.id)).toContain(t.id);
    expect(mine.items.every((i) => i.assigneeId === agentId)).toBe(true);
    expect(mine.items.find((i) => i.id === t.id)!.assigneeName).toBe("agent");
    const found = await listTicketsForAgent(agent.headers, { q: "quokka" });
    expect(found.items.map((i) => i.id)).toEqual([t.id]);
  });

  it("rejects malformed queries", async () => {
    await expect(listTicketsForAgent(agent.headers, { status: "bogus" })).rejects.toBeInstanceOf(ZodError);
  });

  it("inbox options: own members, categories and counts only", async () => {
    const before = await getInboxOptions(agent.headers);
    await submit({ subject: "Counted request" });
    const after = await getInboxOptions(agent.headers);
    expect(after.counts.open).toBe(before.counts.open + 1);
    expect(after.assignees.map((a) => a.name).sort()).toEqual(["admin", "agent", "owner"]);
    expect(after.categories).toContain("billing");

    // Another workspace sees none of it.
    const globex = await getInboxOptions(globexOwner.headers);
    expect(globex.assignees.map((a) => a.id)).toEqual([globexOwnerId]);
    expect(Object.values(globex.counts).reduce((a, b) => a + b, 0)).toBe(
      (await listTicketsForAgent(globexOwner.headers, {})).items.length,
    );
    await expectAppError(getInboxOptions(newcomer.headers), 403);
  });
});

describe("FR-T4 / FR-T6 ticket updates", () => {
  it("applies allowed changes and audits each field", async () => {
    const { ticket: t } = await submit();
    const updated = await updateTicketForAgent(admin.headers, t.id, {
      version: t.version,
      status: "resolved",
      priority: "high",
      category: "billing",
    });
    expect(updated).toMatchObject({
      status: "resolved",
      priority: "high",
      category: "billing",
      version: t.version + 1,
    });
    const audit = await listAuditEvents(getDb().db, acmeId, { limit: 200 });
    const actions = audit.entries.filter((e) => e.targetId === t.id).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(["ticket.status_changed", "ticket.priority_changed", "ticket.category_changed"]),
    );
  });

  it("rejects forbidden transitions, stale versions and unknown categories", async () => {
    const { ticket: t } = await submit();
    const closed = await updateTicketForAgent(agent.headers, t.id, { version: t.version, status: "closed" });
    await expectAppError(
      updateTicketForAgent(agent.headers, t.id, { version: closed.version, status: "open" }),
      409,
    );
    await expectAppError(
      updateTicketForAgent(agent.headers, t.id, { version: t.version, priority: "low" }),
      409,
    );
    await expectAppError(
      updateTicketForAgent(agent.headers, t.id, { version: closed.version, category: "made-up" }),
      400,
    );
  });

  it("only assigns workspace members", async () => {
    const { ticket: t } = await submit();
    await expectAppError(
      updateTicketForAgent(agent.headers, t.id, { version: t.version, assigneeId: globexOwnerId }),
      400,
    );
    const ok = await updateTicketForAgent(agent.headers, t.id, { version: t.version, assigneeId: agentId });
    expect(ok.assigneeId).toBe(agentId);
  });

  it("treats a no-op as no change (no version bump, no audit)", async () => {
    const { ticket: t } = await submit();
    const same = await updateTicketForAgent(agent.headers, t.id, { version: t.version, status: "open" });
    expect(same.version).toBe(t.version);
    const audit = await listAuditEvents(getDb().db, acmeId, { limit: 200 });
    expect(audit.entries.filter((e) => e.targetId === t.id).map((e) => e.action)).toEqual(["ticket.created"]);
  });

  it("rolls back the change when its audit entry can't be written", async () => {
    const { ticket: t } = await submit();
    const { pool } = getDb();
    await pool.query(
      `ALTER TABLE audit_log ADD CONSTRAINT test_block_priority CHECK (action <> 'ticket.priority_changed') NOT VALID`,
    );
    try {
      await expect(
        updateTicketForAgent(agent.headers, t.id, { version: t.version, priority: "urgent" }),
      ).rejects.toThrow();
    } finally {
      await pool.query(`ALTER TABLE audit_log DROP CONSTRAINT test_block_priority`);
    }
    const [row] = await getDb().db.select().from(ticket).where(eq(ticket.id, t.id));
    expect(row).toMatchObject({ priority: "normal", version: t.version });
  });
});

describe("FR-T5 agent replies and notes", () => {
  it("only allows internal notes once a ticket is closed", async () => {
    const { ticket: t } = await submit();
    await updateTicketForAgent(agent.headers, t.id, { version: t.version, status: "closed" });
    await expectAppError(addAgentMessage(agent.headers, t.id, { body: "Public reply" }), 409);
    await addAgentMessage(agent.headers, t.id, { body: "Closing note", internal: true });
    const detail = await getTicketForAgent(agent.headers, t.id);
    expect(detail.messages.at(-1)).toMatchObject({
      body: "Closing note",
      isInternal: true,
      authorName: "agent",
    });
    expect(detail.assignees.map((a) => a.name).sort()).toEqual(["admin", "agent", "owner"]);
    expect(detail.categories).toContain("billing");
  });
});

describe("NFR-SEC1 tenant isolation and roles (T1, T2)", () => {
  it("hides another workspace's tickets behind 404 on every operation", async () => {
    const { ticket: t } = await submit();
    await expectAppError(getTicketForAgent(globexOwner.headers, t.id), 404);
    await expectAppError(getTicketByNumberForAgent(globexOwner.headers, t.number), 404);
    await expectAppError(
      updateTicketForAgent(globexOwner.headers, t.id, { version: t.version, status: "closed" }),
      404,
    );
    await expectAppError(addAgentMessage(globexOwner.headers, t.id, { body: "hi" }), 404);
    const list = await listTicketsForAgent(globexOwner.headers, { q: t.subject });
    expect(list.items.map((i) => i.id)).not.toContain(t.id);
    expect((await getTicketForAgent(owner.headers, t.id)).ticket.status).toBe("open");
  });

  it("returns 404 for malformed ids and numbers instead of a database error", async () => {
    await expectAppError(getTicketForAgent(agent.headers, "not-a-uuid"), 404);
    await expectAppError(
      updateTicketForAgent(agent.headers, "1; DROP TABLE ticket", { version: 1, status: "closed" }),
      404,
    );
    await expectAppError(getTicketByNumberForAgent(agent.headers, "abc"), 404);
    await expectAppError(getTicketByNumberForAgent(agent.headers, 999_999), 404);
  });

  it("requires a session (401) and a workspace (403)", async () => {
    await expectAppError(listTicketsForAgent(new Headers(), {}), 401);
    await expectAppError(listTicketsForAgent(newcomer.headers, {}), 403);
    await expectAppError(addAgentMessage(newcomer.headers, generateUuid(), { body: "x" }), 403);
  });

  it("lets every workspace role work tickets (docs/01 §2.1)", async () => {
    for (const c of [owner, admin, agent]) {
      const { ticket: t } = await submit();
      await addAgentMessage(c.headers, t.id, { body: "On it" });
      await updateTicketForAgent(c.headers, t.id, { version: t.version, status: "pending" });
    }
  });
});

function generateUuid() {
  return crypto.randomUUID();
}
