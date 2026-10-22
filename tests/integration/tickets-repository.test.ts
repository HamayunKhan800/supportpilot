import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getAuth } from "@/server/platform/auth";
import { getSessionContext } from "@/server/platform/auth/context";
import { getDb } from "@/server/platform/db/client";
import { member, ticket, ticketMessage } from "@/server/platform/db/schema";
import {
  countTicketsByStatus,
  findTicketById,
  findTicketByNumber,
  findTicketByTokenHash,
  insertMessage,
  insertTicket,
  listMessages,
  listTickets,
  transaction,
  updateTicket,
  type Ticket,
} from "@/server/modules/tickets/repository";
import { resetDatabase, signUpAndIn } from "./support/client";

const handler = (req: Request) => getAuth().handler(req);
const hash = () => createHash("sha256").update(randomBytes(32)).digest("base64url");

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

function newTicket(
  workspaceId: string,
  over: Partial<{ subject: string; body: string; email: string }> = {},
) {
  return transaction((tx) =>
    insertTicket(tx, workspaceId, {
      subject: over.subject ?? "Cannot sync my files",
      customerName: "Casey Customer",
      customerEmail: over.email ?? "casey@example.test",
      accessTokenHash: hash(),
      firstMessage: over.body ?? "The desktop app stopped syncing yesterday.",
    }),
  );
}

let acmeId: string, globexId: string, agentId: string, outsiderId: string;

beforeAll(async () => {
  await resetDatabase();
  const owner = await signUpAndIn(handler, "owner@acme.test");
  const agent = await signUpAndIn(handler, "agent@acme.test");
  const globexOwner = await signUpAndIn(handler, "owner@globex.test");
  acmeId = (await owner.post("/organization/create", { name: "Acme", slug: "acme" })).json.id;
  globexId = (await globexOwner.post("/organization/create", { name: "Globex", slug: "globex" })).json.id;
  agentId = (await getSessionContext(agent.headers))!.user.id;
  outsiderId = (await getSessionContext(globexOwner.headers))!.user.id;
  await getAuth().api.addMember({ body: { userId: agentId, role: "agent", organizationId: acmeId } });
});

describe("ticket numbers (D3)", () => {
  it("are unique and gap-free per workspace under concurrency", async () => {
    const created = await Promise.all(Array.from({ length: 20 }, () => newTicket(acmeId)));
    expect(created.map((t) => t.number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    // Another workspace has its own sequence.
    expect((await newTicket(globexId)).number).toBe(1);
  });
});

describe("tenant isolation (T1)", () => {
  let acmeTicket: Ticket;
  beforeAll(async () => {
    acmeTicket = await newTicket(acmeId, { subject: "Zebra-unique subject" });
  });

  it("never returns another workspace's ticket", async () => {
    expect(await findTicketById(globexId, acmeTicket.id)).toBeNull();
    expect(await findTicketByNumber(globexId, acmeTicket.number)).toBeNull();
    expect(await listMessages(globexId, acmeTicket.id, { includeInternal: true })).toEqual([]);
    const { items } = await listTickets(globexId, { sort: "newest", limit: 100, q: "zebra" });
    expect(items).toEqual([]);
  });

  it("cannot update another workspace's ticket", async () => {
    const result = await transaction((tx) =>
      updateTicket(tx, globexId, acmeTicket.id, acmeTicket.version, { status: "closed" }),
    );
    expect(result).toBeNull();
    expect((await findTicketById(acmeId, acmeTicket.id))!.status).toBe("open");
  });

  it("database rejects a message pointing at another workspace's ticket", async () => {
    const state = await sqlState(
      getDb().db.insert(ticketMessage).values({
        workspaceId: globexId,
        ticketId: acmeTicket.id,
        authorType: "agent",
        body: "cross-tenant",
      }),
    );
    expect(state).toBe("23503"); // foreign_key_violation (composite FK)
  });

  it("ignores a paging cursor from another workspace", async () => {
    const { items } = await listTickets(globexId, { sort: "newest", limit: 10, afterId: acmeTicket.id });
    expect(items).toEqual([]);
  });
});

describe("database constraints", () => {
  it("rejects internal notes not written by an agent", async () => {
    const t = await newTicket(acmeId);
    const state = await sqlState(
      getDb().db.insert(ticketMessage).values({
        workspaceId: acmeId,
        ticketId: t.id,
        authorType: "customer",
        body: "x",
        isInternal: true,
      }),
    );
    expect(state).toBe("23514"); // check_violation
  });

  it("rejects unknown statuses even from raw SQL", async () => {
    const t = await newTicket(acmeId);
    const state = await sqlState(
      getDb().pool.query(`UPDATE ticket SET status = 'deleted' WHERE id = $1`, [t.id]),
    );
    expect(state).toBe("23514");
  });

  it("only allows workspace members as assignees", async () => {
    const t = await newTicket(acmeId);
    const state = await sqlState(
      transaction((tx) => updateTicket(tx, acmeId, t.id, 1, { assigneeId: outsiderId })),
    );
    expect(state).toBe("23503");
  });

  it("unassigns tickets when the assignee leaves the workspace", async () => {
    const t = await newTicket(acmeId);
    await transaction((tx) => updateTicket(tx, acmeId, t.id, 1, { assigneeId: agentId }));
    const { db } = getDb();
    const [m] = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, acmeId), eq(member.userId, agentId)));
    await db.delete(member).where(eq(member.id, m!.id));
    const after = await findTicketById(acmeId, t.id);
    expect(after).toMatchObject({ assigneeId: null, workspaceId: acmeId });
    await db.insert(member).values({ ...m!, id: m!.id }); // restore for later tests
  });
});

describe("optimistic concurrency (D4)", () => {
  it("applies the first update and rejects a second one based on the same version", async () => {
    const t = await newTicket(acmeId);
    const first = await transaction((tx) => updateTicket(tx, acmeId, t.id, t.version, { priority: "high" }));
    const second = await transaction((tx) => updateTicket(tx, acmeId, t.id, t.version, { priority: "low" }));
    expect(first).toMatchObject({ priority: "high", version: t.version + 1 });
    expect(second).toBeNull();
    expect((await findTicketById(acmeId, t.id))!.priority).toBe("high");
  });
});

describe("messages", () => {
  it("hides internal notes unless asked for, oldest first", async () => {
    const t = await newTicket(acmeId);
    await transaction(async (tx) => {
      await insertMessage(tx, acmeId, t.id, {
        authorType: "agent",
        authorUserId: agentId,
        body: "Customer is on the legacy plan",
        isInternal: true,
      });
      await insertMessage(tx, acmeId, t.id, {
        authorType: "agent",
        authorUserId: agentId,
        body: "Thanks, we're looking into it.",
        isInternal: false,
      });
    });
    const agentView = await listMessages(acmeId, t.id, { includeInternal: true });
    const customerView = await listMessages(acmeId, t.id, { includeInternal: false });
    expect(agentView.map((m) => m.isInternal)).toEqual([false, true, false]);
    expect(customerView.every((m) => !m.isInternal)).toBe(true);
    expect(customerView).toHaveLength(2);
    expect(agentView[1]!.authorName).toBe("agent");
  });

  it("finds a ticket by the hash of its tracking token only", async () => {
    const tokenHash = hash();
    const t = await transaction((tx) =>
      insertTicket(tx, acmeId, {
        subject: "Token test",
        customerName: "C",
        customerEmail: "c@example.test",
        accessTokenHash: tokenHash,
        firstMessage: "hello there",
      }),
    );
    expect((await findTicketByTokenHash(tokenHash))!.id).toBe(t.id);
    expect(await findTicketByTokenHash(hash())).toBeNull();
    expect(t).not.toHaveProperty("accessTokenHash");
  });
});

describe("search and filters (D9)", () => {
  let invoice: Ticket, laptop: Ticket;
  beforeAll(async () => {
    invoice = await newTicket(globexId, { subject: "Invoice question", body: "Double charged in March" });
    laptop = await newTicket(globexId, {
      subject: "Laptop setup",
      body: "Install help needed",
      email: "lee@corp.test",
    });
  });

  const search = (q: string) =>
    listTickets(globexId, { sort: "newest", limit: 50, q }).then((r) => r.items.map((t) => t.id));

  it("matches subject, message body, customer email and ticket number", async () => {
    expect(await search("invoice")).toEqual([invoice.id]);
    expect(await search("charged")).toEqual([invoice.id]);
    expect(await search("lee@corp.test")).toEqual([laptop.id]);
    expect(await search(`#${laptop.number}`)).toEqual([laptop.id]);
  });

  it("supports websearch syntax and treats odd input as text, not SQL", async () => {
    expect(await search("help -laptop")).toEqual([]);
    expect(await search("'; DROP TABLE ticket; --")).toEqual([]);
    expect(await findTicketById(globexId, invoice.id)).not.toBeNull();
  });

  it("filters by status, priority and assignee", async () => {
    await transaction((tx) =>
      updateTicket(tx, globexId, invoice.id, 1, { status: "pending", priority: "urgent" }),
    );
    const ids = async (f: Parameters<typeof listTickets>[1]) =>
      (await listTickets(globexId, f)).items.map((t) => t.id);
    expect(await ids({ sort: "newest", limit: 50, status: ["pending"] })).toEqual([invoice.id]);
    expect(await ids({ sort: "newest", limit: 50, priority: "urgent" })).toEqual([invoice.id]);
    expect(await ids({ sort: "newest", limit: 50, assignee: "unassigned", q: "laptop" })).toEqual([
      laptop.id,
    ]);
  });

  it("counts tickets by status", async () => {
    const counts = await countTicketsByStatus(globexId);
    expect(counts).toMatchObject({ pending: 1, resolved: 0, closed: 0 });
    expect(counts.open).toBeGreaterThanOrEqual(2);
  });
});

describe("keyset pagination", () => {
  it("visits every ticket exactly once in both directions, even with identical timestamps", async () => {
    const { pool } = getDb();
    // Force ties: every Acme ticket gets the same created_at.
    await pool.query(`UPDATE ticket SET created_at = '2026-01-01T00:00:00Z' WHERE workspace_id = $1`, [
      acmeId,
    ]);
    const total = (
      await getDb().db.select({ id: ticket.id }).from(ticket).where(eq(ticket.workspaceId, acmeId))
    ).length;

    for (const sort of ["newest", "oldest"] as const) {
      const seen: string[] = [];
      let afterId: string | undefined;
      for (let page = 0; page < 50; page++) {
        const r = await listTickets(acmeId, { sort, limit: 4, afterId });
        seen.push(...r.items.map((t) => t.id));
        if (!r.nextCursor) break;
        afterId = r.nextCursor;
      }
      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total);
    }
  });
});
