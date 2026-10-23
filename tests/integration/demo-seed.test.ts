import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAuth } from "@/server/platform/auth";
import { listAuditEvents } from "@/server/platform/auth/audit";
import { getSessionContext } from "@/server/platform/auth/context";
import { getDb } from "@/server/platform/db/client";
import { stopWebBoss } from "@/server/platform/jobs/boss";
import { AI_TRIAGE_QUEUE } from "@/server/platform/jobs/queues";
import { seedDemoTickets } from "@/server/modules/tickets/demo/seed";
import { DEMO_TICKETS } from "@/server/modules/tickets/demo/tickets";
import {
  createPortalTicket,
  getTicketByNumberForAgent,
  getTicketCounts,
  listTicketsForAgent,
} from "@/server/modules/tickets/service";
import { resetDatabase, signUpAndIn, type TestClient } from "./support/client";

const handler = (req: Request) => getAuth().handler(req);
const HOUR = 3_600_000;
const NOW = new Date("2026-10-22T12:00:00Z");

let owner: TestClient, other: TestClient;
let nimbusId: string, otherId: string;
let staff: { owner: string; admin: string; agent: string };

const byKey = (key: string) => DEMO_TICKETS.find((t) => t.key === key)!;
/** Ticket numbers follow creation time: the oldest demo ticket is #1. */
const numberOf = (key: string) =>
  [...DEMO_TICKETS].sort((a, b) => b.ageHours - a.ageHours).findIndex((t) => t.key === key) + 1;

afterAll(async () => {
  await stopWebBoss();
});

beforeAll(async () => {
  await resetDatabase();
  owner = await signUpAndIn(handler, "owner@nimbus.test");
  const admin = await signUpAndIn(handler, "admin@nimbus.test");
  const agent = await signUpAndIn(handler, "agent@nimbus.test");
  other = await signUpAndIn(handler, "owner@other.test");
  nimbusId = (await owner.post("/organization/create", { name: "Nimbus", slug: "nimbus" })).json.id;
  otherId = (await other.post("/organization/create", { name: "Other", slug: "other" })).json.id;
  staff = {
    owner: (await getSessionContext(owner.headers))!.user.id,
    admin: (await getSessionContext(admin.headers))!.user.id,
    agent: (await getSessionContext(agent.headers))!.user.id,
  };
  for (const role of ["admin", "agent"] as const) {
    await getAuth().api.addMember({ body: { userId: staff[role], role, organizationId: nimbusId } });
  }
});

describe("demo seed (D10)", () => {
  it("loads all 25 tickets with their status, labels and assignees", async () => {
    const auditBefore = (await listAuditEvents(getDb().db, nimbusId, { limit: 100 })).entries.length;
    expect(await seedDemoTickets(nimbusId, staff, NOW)).toBe(25);

    const counts = await getTicketCounts(owner.headers);
    for (const status of ["open", "pending", "resolved", "closed"] as const) {
      expect(counts[status]).toBe(DEMO_TICKETS.filter((t) => t.status === status).length);
    }
    const all = await listTicketsForAgent(owner.headers, {
      status: "open,pending,resolved,closed",
      limit: 50,
    });
    expect(all.items.map((t) => t.number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );

    // No invented history: seeding writes no audit events.
    expect((await listAuditEvents(getDb().db, nimbusId, { limit: 100 })).entries.length).toBe(auditBefore);
  });

  it("queues AI triage for the new, unlabelled tickets only, like portal tickets", async () => {
    const { rows } = await getDb().db.execute<{ number: number }>(sql`
      SELECT t.number FROM pgboss.job j JOIN ticket t ON t.id::text = j.data->>'ticketId'
      WHERE j.name = ${AI_TRIAGE_QUEUE} AND t.workspace_id = ${nimbusId} ORDER BY t.number`);
    const unlabelled = DEMO_TICKETS.filter((t) => t.category === null);
    expect(unlabelled.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.number)).toEqual(unlabelled.map((t) => numberOf(t.key)).sort((a, b) => a - b));
  });

  it("keeps the thread, internal notes, authors and times", async () => {
    const d = byKey("nim-02");
    const { ticket, messages } = await getTicketByNumberForAgent(owner.headers, numberOf("nim-02"));
    expect(ticket).toMatchObject({
      subject: d.subject,
      status: "pending",
      priority: "urgent",
      category: "bug",
      assigneeId: staff.agent,
    });
    expect(messages.map((m) => [m.authorType, m.isInternal])).toEqual([
      ["customer", false],
      ["agent", false],
      ["agent", true],
    ]);
    expect(messages[1]!.authorUserId).toBe(staff.agent);
    const openedAt = NOW.getTime() - d.ageHours * HOUR;
    expect(ticket.createdAt.getTime()).toBe(openedAt);
    expect(messages[0]!.createdAt.getTime()).toBe(openedAt);
    expect(ticket.lastActivityAt.getTime()).toBe(openedAt + d.thread.at(-1)!.afterHours * HOUR);
  });

  it("untriaged tickets stay untriaged, and follow-up messages are searchable", async () => {
    const injection = await getTicketByNumberForAgent(owner.headers, numberOf("nim-15"));
    expect(injection.ticket).toMatchObject({ category: null, assigneeId: null, status: "open" });
    const found = await listTicketsForAgent(owner.headers, {
      q: "Live Photos",
      status: "open,pending,resolved,closed",
    });
    expect(found.items.map((t) => t.number)).toEqual([numberOf("nim-22")]);
  });

  it("is idempotent, also under concurrent runs, and scoped to one workspace", async () => {
    expect(await seedDemoTickets(nimbusId, staff, NOW)).toBe(0);
    expect(
      (await listTicketsForAgent(owner.headers, { status: "open,pending,resolved,closed", limit: 50 })).items,
    ).toHaveLength(25);

    // Another workspace: two runs at once must still produce exactly one set.
    const otherOwner = (await getSessionContext(other.headers))!.user.id;
    const otherStaff = { owner: otherOwner, admin: otherOwner, agent: otherOwner };
    const results = await Promise.all([
      seedDemoTickets(otherId, otherStaff, NOW),
      seedDemoTickets(otherId, otherStaff, NOW),
    ]);
    expect(results.sort()).toEqual([0, 25]);
    const otherCounts = await getTicketCounts(other.headers);
    expect(Object.values(otherCounts).reduce((a, b) => a + b, 0)).toBe(25);
  });

  it("never seeds a workspace that already has real tickets", async () => {
    const fresh = await signUpAndIn(handler, "owner@busy.test");
    const busyId = (await fresh.post("/organization/create", { name: "Busy", slug: "busy" })).json.id;
    await createPortalTicket(
      "busy",
      {
        name: "Real Person",
        email: "real@example.test",
        subject: "A real request",
        message: "Please do not bury me under demo data.",
      },
      "198.51.100.7",
    );
    const id = (await getSessionContext(fresh.headers))!.user.id;
    expect(await seedDemoTickets(busyId, { owner: id, admin: id, agent: id }, NOW)).toBe(0);
    expect((await listTicketsForAgent(fresh.headers, {})).items).toHaveLength(1);
  });
});
