import { beforeAll, describe, expect, it } from "vitest";
import { getAuth } from "@/server/platform/auth";
import { getDb } from "@/server/platform/db/client";
import { auditLog } from "@/server/platform/db/schema";
import { AppError } from "@/server/platform/errors";
import { listAuditEntries, listPendingInvitations } from "@/server/modules/workspaces/repository";
import { getAppContext, getAuditPage, getMembersPage } from "@/server/modules/workspaces/service";
import { resetDatabase, signUpAndIn, type TestClient } from "./support/client";

const handler = (req: Request) => getAuth().handler(req);

/** Acme (owner + agent, one pending invite) and Globex (owner, one pending invite). */
let owner: TestClient, agent: TestClient, globexOwner: TestClient, newcomer: TestClient;
let acmeId: string, globexId: string, globexInviteId: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await signUpAndIn(handler, "owner@acme.test");
  agent = await signUpAndIn(handler, "agent@acme.test");
  globexOwner = await signUpAndIn(handler, "owner@globex.test");
  newcomer = await signUpAndIn(handler, "newcomer@example.test");

  acmeId = (await owner.post("/organization/create", { name: "Acme", slug: "acme" })).json.id;
  globexId = (await globexOwner.post("/organization/create", { name: "Globex", slug: "globex" })).json.id;

  const inv = await owner.post("/organization/invite-member", { email: "agent@acme.test", role: "agent" });
  await agent.post("/organization/accept-invitation", { invitationId: inv.json.id });
  await owner.post("/organization/invite-member", { email: "pending@acme.test", role: "admin" });
  globexInviteId = (
    await globexOwner.post("/organization/invite-member", { email: "pending@globex.test", role: "agent" })
  ).json.id;
});

describe("getAppContext", () => {
  it("distinguishes signed-out, no-workspace and ok", async () => {
    expect(await getAppContext(new Headers())).toEqual({ status: "signed-out" });
    expect((await getAppContext(newcomer.headers)).status).toBe("no-workspace");
    const app = await getAppContext(owner.headers);
    expect(app.status === "ok" && app.ctx.workspace.id).toBe(acmeId);
  });

  it("re-selects a membership when no workspace is active (AR-003)", async () => {
    await owner.post("/organization/set-active", { organizationId: null });
    const app = await getAppContext(owner.headers);
    expect(app.status === "ok" && app.ctx.workspace.id).toBe(acmeId);
  });
});

describe("getMembersPage (tenant isolation)", () => {
  it("shows only the active workspace's members and invitations to an owner", async () => {
    const page = await getMembersPage(owner.headers);
    expect(page.members.map((m) => m.email).sort()).toEqual(["agent@acme.test", "owner@acme.test"]);
    expect(page.invitations.map((i) => i.email)).toEqual(["pending@acme.test"]);
    expect(page).toMatchObject({ canManage: true, canInvite: true });
  });

  it("lets agents see members but not manage them or see invitations", async () => {
    const page = await getMembersPage(agent.headers);
    expect(page.members).toHaveLength(2);
    expect(page).toMatchObject({ canManage: false, canInvite: false, invitations: [] });
  });

  it("rejects callers without a workspace", async () => {
    await expect(getMembersPage(newcomer.headers)).rejects.toBeInstanceOf(AppError);
  });

  it("hides expired invitations", async () => {
    const inEightDays = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(await listPendingInvitations(acmeId, inEightDays)).toEqual([]);
  });
});

describe("getAuditPage", () => {
  it("returns only the caller's workspace entries", async () => {
    const page = await getAuditPage(owner.headers);
    expect(page.entries.length).toBeGreaterThan(0);
    expect(page.entries.map((e) => e.targetId)).not.toContain(globexInviteId);
    expect(page.entries.map((e) => e.targetId)).not.toContain(globexId);
  });

  it("is forbidden for agents (403)", async () => {
    await expect(getAuditPage(agent.headers)).rejects.toMatchObject({ status: 403 });
  });

  it("ignores malformed cursors instead of failing", async () => {
    const page = await getAuditPage(owner.headers, "not-a-cursor' or 1=1 --");
    expect(page.entries.length).toBeGreaterThan(0);
  });

  it("returns nothing for a cursor from another workspace", async () => {
    const globexEntries = await listAuditEntries(globexId, { limit: 1 });
    const page = await listAuditEntries(acmeId, { limit: 10, afterId: globexEntries.entries[0]!.id });
    expect(page.entries).toEqual([]);
  });

  it("pages without skipping entries that share a timestamp", async () => {
    const { db } = getDb();
    const at = new Date("2026-01-01T00:00:00.000Z");
    // Microsecond-distinct times inside one millisecond: a millisecond cursor would skip some.
    for (const us of ["000100", "000200", "000300"]) {
      await db.insert(auditLog).values({
        workspaceId: globexId,
        actorType: "system",
        action: "workspace.updated",
        targetType: "workspace",
        targetId: `tie-${us}`,
        metadata: {},
        createdAt: new Date(at), // overwritten below with µs precision
      });
    }
    // Set µs-precision timestamps directly in SQL (JS Dates only carry milliseconds).
    const { pool } = getDb();
    await pool.query(
      `update audit_log set created_at = '2026-01-01T00:00:00.000Z'::timestamptz + (substr(target_id, 5)::int * interval '1 microsecond') where target_id like 'tie-%'`,
    );

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const page = await listAuditEntries(globexId, { limit: 1, afterId: cursor });
      seen.push(...page.entries.map((e) => e.targetId ?? ""));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen.filter((t) => t.startsWith("tie-"))).toEqual(["tie-000300", "tie-000200", "tie-000100"]);
  });
});
