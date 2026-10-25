import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getAuth } from "@/server/platform/auth";
import { listAuditEvents } from "@/server/platform/auth/audit";
import { getSessionContext, getWorkspaceContext, requireWorkspace } from "@/server/platform/auth/context";
import { getDb } from "@/server/platform/db/client";
import { invitation, member, session, workspaceSettings } from "@/server/platform/db/schema";
import { AppError } from "@/server/platform/errors";
import { logger } from "@/server/platform/logger";
import { resetDatabase, signUpAndIn, type TestClient } from "./support/client";

const handler = (req: Request) => getAuth().handler(req);

/** Two independent tenants: Acme (owner, admin, agent) and Globex (owner only). */
let owner: TestClient, admin: TestClient, agent: TestClient, outsider: TestClient;
let acmeId: string, globexId: string;
let adminMemberId: string, agentMemberId: string, ownerMemberId: string, globexOwnerMemberId: string;

const denied = (status: number) => status >= 400 && status < 500;

async function memberRole(id: string) {
  const { db } = getDb();
  const [m] = await db.select().from(member).where(eq(member.id, id));
  return m?.role;
}

async function invite(by: TestClient, email: string, role: string, organizationId = acmeId) {
  return by.post("/organization/invite-member", { email, role, organizationId });
}

async function join(client: TestClient, email: string, role: "admin" | "agent", by = owner, orgId = acmeId) {
  const inv = await invite(by, email, role, orgId);
  expect(inv.status).toBe(200);
  const acc = await client.post("/organization/accept-invitation", { invitationId: inv.json.id });
  expect(acc.status).toBe(200);
  return acc.json.member.id as string;
}

beforeAll(async () => {
  await resetDatabase();
  owner = await signUpAndIn(handler, "owner@acme.test");
  admin = await signUpAndIn(handler, "admin@acme.test");
  agent = await signUpAndIn(handler, "agent@acme.test");
  outsider = await signUpAndIn(handler, "owner@globex.test");

  const acme = await owner.post("/organization/create", { name: "Acme Support", slug: "acme" });
  expect(acme.status).toBe(200);
  acmeId = acme.json.id;
  const globex = await outsider.post("/organization/create", { name: "Globex", slug: "globex" });
  expect(globex.status).toBe(200);
  globexId = globex.json.id;

  adminMemberId = await join(admin, "admin@acme.test", "admin");
  agentMemberId = await join(agent, "agent@acme.test", "agent");
  for (const c of [admin, agent]) await c.post("/organization/set-active", { organizationId: acmeId });

  const { db } = getDb();
  ownerMemberId = (await db.select().from(member).where(eq(member.organizationId, acmeId))).find(
    (m) => m.role === "owner",
  )!.id;
  globexOwnerMemberId = (await db.select().from(member).where(eq(member.organizationId, globexId)))[0]!.id;
});

describe("workspaces (FR-A2, FR-A4)", () => {
  it("makes the creator owner, sets it active and creates default settings", async () => {
    const ctx = await getWorkspaceContext(owner.headers);
    expect(ctx?.workspace).toMatchObject({ id: acmeId, slug: "acme", name: "Acme Support" });
    expect(ctx?.role).toBe("owner");
    const { db } = getDb();
    const [settings] = await db
      .select()
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, acmeId));
    expect(settings?.categories).toContain("billing");
  });

  it.each([
    ["reserved", "admin"],
    ["too short", "ab"],
    ["uppercase", "Acme-2"],
    ["double hyphen", "acme--support"],
  ])("rejects an invalid slug (%s)", async (_label, slug) => {
    const res = await owner.post("/organization/create", { name: "Bad", slug });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate slug", async () => {
    const res = await outsider.post("/organization/create", { name: "Copycat", slug: "acme" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("lets one user belong to several workspaces and switch between them", async () => {
    const second = await agent.post("/organization/create", {
      name: "Agent Side Project",
      slug: "agent-side",
    });
    expect(second.status).toBe(200);
    expect((await getWorkspaceContext(agent.headers))?.workspace.slug).toBe("agent-side");
    await agent.post("/organization/set-active", { organizationId: acmeId });
    const ctx = await getWorkspaceContext(agent.headers);
    expect(ctx?.workspace.slug).toBe("acme");
    expect(ctx?.role).toBe("agent");
  });
});

describe("invitations (FR-A3)", () => {
  it("expire after 7 days", async () => {
    const res = await invite(owner, "later@acme.test", "agent");
    expect(res.status).toBe(200);
    const days = (new Date(res.json.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7.01);
  });

  it("cannot grant the owner role", async () => {
    expect((await invite(owner, "boss@acme.test", "owner")).status).toBe(400);
  });

  it("are single-use", async () => {
    const newbie = await signUpAndIn(handler, "newbie@acme.test");
    const inv = await invite(owner, "newbie@acme.test", "agent");
    expect((await newbie.post("/organization/accept-invitation", { invitationId: inv.json.id })).status).toBe(
      200,
    );
    const again = await newbie.post("/organization/accept-invitation", { invitationId: inv.json.id });
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  it("can only be accepted by the invited email address", async () => {
    const inv = await invite(owner, "intended@acme.test", "admin");
    const res = await outsider.post("/organization/accept-invitation", { invitationId: inv.json.id });
    expect(res.status).toBe(403);
    const { db } = getDb();
    const members = await db.select().from(member).where(eq(member.organizationId, acmeId));
    expect(members.some((m) => m.role === "admin" && m.id !== adminMemberId)).toBe(false);
  });

  it("re-inviting cancels the previous pending invitation", async () => {
    const first = await invite(owner, "twice@acme.test", "agent");
    const second = await owner.post("/organization/invite-member", {
      email: "twice@acme.test",
      role: "agent",
      organizationId: acmeId,
      resend: true,
    });
    expect(second.status).toBe(200);
    const { db } = getDb();
    const rows = await db.select().from(invitation).where(eq(invitation.email, "twice@acme.test"));
    const pending = rows.filter((r) => r.status === "pending");
    expect(pending).toHaveLength(1);
    expect(first.status).toBe(200);
  });
});

describe("role matrix enforced server-side (docs/01-requirements.md §2.1, T2)", () => {
  it("agent cannot invite, change roles, remove members or edit the workspace", async () => {
    expect((await invite(agent, "x1@acme.test", "agent")).status).toBe(403);
    const role = await agent.post("/organization/update-member-role", {
      memberId: adminMemberId,
      role: "agent",
      organizationId: acmeId,
    });
    expect(denied(role.status)).toBe(true);
    const remove = await agent.post("/organization/remove-member", {
      memberIdOrEmail: adminMemberId,
      organizationId: acmeId,
    });
    expect(denied(remove.status)).toBe(true);
    const rename = await agent.post("/organization/update", {
      data: { name: "Hacked" },
      organizationId: acmeId,
    });
    expect(denied(rename.status)).toBe(true);

    expect(await memberRole(adminMemberId)).toBe("admin");
    expect((await getWorkspaceContext(owner.headers))?.workspace.name).toBe("Acme Support");
  });

  it("agent cannot promote themself", async () => {
    const res = await agent.post("/organization/update-member-role", {
      memberId: agentMemberId,
      role: "admin",
      organizationId: acmeId,
    });
    expect(res.status).toBe(403);
    expect((await getWorkspaceContext(agent.headers))?.role).toBe("agent");
  });

  it("admin can invite and change roles between agent and admin", async () => {
    expect((await invite(admin, "hire@acme.test", "agent")).status).toBe(200);
    const promote = await admin.post("/organization/update-member-role", {
      memberId: agentMemberId,
      role: "admin",
      organizationId: acmeId,
    });
    expect(promote.status).toBe(200);
    const demote = await admin.post("/organization/update-member-role", {
      memberId: agentMemberId,
      role: "agent",
      organizationId: acmeId,
    });
    expect(demote.status).toBe(200);
  });

  it("nobody can change the owner's role, remove the owner or grant ownership", async () => {
    for (const actor of [admin, owner]) {
      const res = await actor.post("/organization/update-member-role", {
        memberId: ownerMemberId,
        role: "agent",
        organizationId: acmeId,
      });
      expect(denied(res.status)).toBe(true);
    }
    const remove = await admin.post("/organization/remove-member", {
      memberIdOrEmail: ownerMemberId,
      organizationId: acmeId,
    });
    expect(denied(remove.status)).toBe(true);
    const grant = await owner.post("/organization/update-member-role", {
      memberId: adminMemberId,
      role: "owner",
      organizationId: acmeId,
    });
    expect(denied(grant.status)).toBe(true);

    expect(await memberRole(ownerMemberId)).toBe("owner");
    expect(await memberRole(adminMemberId)).toBe("admin");
  });

  it("workspace deletion is disabled for everyone (pending a data-retention flow)", async () => {
    const res = await owner.post("/organization/delete", { organizationId: acmeId });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await getWorkspaceContext(owner.headers))?.workspace.id).toBe(acmeId);
  });

  it("requireWorkspace() maps roles to 401/403 for application services", async () => {
    await expect(requireWorkspace(new Headers(), { audit: ["read"] })).rejects.toMatchObject({ status: 401 });
    await expect(requireWorkspace(agent.headers, { audit: ["read"] })).rejects.toBeInstanceOf(AppError);
    await expect(requireWorkspace(agent.headers, { audit: ["read"] })).rejects.toMatchObject({ status: 403 });
    await expect(requireWorkspace(admin.headers, { audit: ["read"] })).resolves.toMatchObject({
      role: "admin",
    });
    await expect(requireWorkspace(agent.headers, { ticket: ["read"] })).resolves.toMatchObject({
      role: "agent",
    });
  });

  it("logs a refused permission with who, where and what, but no names or emails (M7-09)", async () => {
    const warn = vi.spyOn(logger, "warn");
    try {
      await expect(requireWorkspace(agent.headers, { audit: ["read"] })).rejects.toMatchObject({
        status: 403,
      });
      const entry = warn.mock.calls.find(
        ([fields]) => (fields as { event?: string }).event === "authz.denied",
      );
      const agentId = (await getSessionContext(agent.headers))!.user.id;
      expect(entry?.[0]).toEqual({
        event: "authz.denied",
        userId: agentId,
        workspaceId: acmeId,
        role: "agent",
        permission: { audit: ["read"] },
      });
      expect(JSON.stringify(entry)).not.toContain("@");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("tenant isolation (T1 IDOR)", () => {
  it("an Acme owner cannot read Globex's workspace, members or invitations", async () => {
    expect((await owner.get("/organization/list-members", { organizationId: globexId })).status).toBe(403);
    expect((await owner.get("/organization/list-invitations", { organizationId: globexId })).status).toBe(
      403,
    );
    const full = await owner.get("/organization/get-full-organization", { organizationId: globexId });
    expect(full.status).toBe(403);
    // Documented Better Auth behaviour: probing a foreign workspace clears your active
    // workspace (fails closed). The app re-selects one of your own workspaces.
    expect(await getWorkspaceContext(owner.headers)).toBeNull();
    expect((await owner.post("/organization/set-active", { organizationId: acmeId })).status).toBe(200);
  });

  it("an Acme owner cannot change Globex's members, invitations or settings", async () => {
    const spy = await invite(owner, "spy@globex.test", "admin", globexId);
    expect(denied(spy.status)).toBe(true);
    const role = await owner.post("/organization/update-member-role", {
      memberId: globexOwnerMemberId,
      role: "agent",
      organizationId: globexId,
    });
    expect(denied(role.status)).toBe(true);
    const remove = await owner.post("/organization/remove-member", {
      memberIdOrEmail: globexOwnerMemberId,
      organizationId: globexId,
    });
    expect(denied(remove.status)).toBe(true);
    const rename = await owner.post("/organization/update", {
      data: { name: "Pwned" },
      organizationId: globexId,
    });
    expect(denied(rename.status)).toBe(true);

    const globexInvite = await invite(outsider, "someone@globex.test", "agent", globexId);
    expect(globexInvite.status).toBe(200);
    const cancel = await owner.post("/organization/cancel-invitation", {
      invitationId: globexInvite.json.id,
    });
    expect(denied(cancel.status)).toBe(true);

    const { db } = getDb();
    expect(await memberRole(globexOwnerMemberId)).toBe("owner");
    const invs = await db.select().from(invitation).where(eq(invitation.organizationId, globexId));
    expect(invs.map((i) => [i.email, i.status])).toEqual([["someone@globex.test", "pending"]]);
    const ctx = await getWorkspaceContext(outsider.headers);
    expect(ctx?.workspace.name).toBe("Globex");
  });

  it("using a member ID from another workspace with your own workspace ID fails", async () => {
    const res = await owner.post("/organization/update-member-role", {
      memberId: globexOwnerMemberId,
      role: "agent",
      organizationId: acmeId,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const { db } = getDb();
    const [m] = await db.select().from(member).where(eq(member.id, globexOwnerMemberId));
    expect(m?.role).toBe("owner");
  });

  it("cannot switch the active workspace to one you are not a member of", async () => {
    const res = await owner.post("/organization/set-active", { organizationId: globexId });
    expect(res.status).toBe(403);
    expect((await getWorkspaceContext(owner.headers))?.workspace.id).not.toBe(globexId);
    await owner.post("/organization/set-active", { organizationId: acmeId });
  });

  it("re-checks membership on every request, even if the session points elsewhere", async () => {
    // Simulate stale or tampered session state: point an Acme session at Globex.
    const { db } = getDb();
    const userId = (await getWorkspaceContext(agent.headers))!.user.id;
    await db.update(session).set({ activeOrganizationId: globexId }).where(eq(session.userId, userId));
    expect(await getWorkspaceContext(agent.headers)).toBeNull();
    await expect(requireWorkspace(agent.headers, { ticket: ["read"] })).rejects.toMatchObject({
      status: 403,
    });
    await agent.post("/organization/set-active", { organizationId: acmeId });
    expect((await getWorkspaceContext(agent.headers))?.workspace.id).toBe(acmeId);
  });

  it("removal takes effect immediately for the removed member's open session", async () => {
    const temp = await signUpAndIn(handler, "temp@acme.test");
    const tempMemberId = await join(temp, "temp@acme.test", "agent");
    await temp.post("/organization/set-active", { organizationId: acmeId });
    expect((await getWorkspaceContext(temp.headers))?.role).toBe("agent");

    const res = await admin.post("/organization/remove-member", {
      memberIdOrEmail: tempMemberId,
      organizationId: acmeId,
    });
    expect(res.status).toBe(200);
    expect(await getWorkspaceContext(temp.headers)).toBeNull();
  });
});

describe("audit log (T15)", () => {
  it("records who did what, scoped to the workspace", async () => {
    const { db } = getDb();
    const { entries } = await listAuditEvents(db, acmeId, { limit: 100 });
    const actions = entries.map((e) => e.action);
    for (const a of [
      "workspace.created",
      "invitation.created",
      "invitation.accepted",
      "member.role_changed",
      "member.removed",
    ]) {
      expect(actions).toContain(a);
    }
    expect(entries.every((e) => e.workspaceId === acmeId)).toBe(true);

    expect(entries.every((e) => e.actorUserId !== null && e.actorType === "user")).toBe(true);
    const ownerId = (await getWorkspaceContext(owner.headers))!.user.id;
    const created = entries.find((e) => e.action === "workspace.created");
    expect(created?.actorUserId).toBe(ownerId);
    expect(created?.actorType).toBe("user");

    const adminId = (await getWorkspaceContext(admin.headers))!.user.id;
    const removed = entries.find((e) => e.action === "member.removed");
    expect(removed?.actorUserId).toBe(adminId);
  });

  it("does not store invitee email addresses", async () => {
    const { db } = getDb();
    const { entries } = await listAuditEvents(db, acmeId, { limit: 100 });
    expect(JSON.stringify(entries)).not.toMatch(/@acme\.test/);
  });

  it("does not record denied actions", async () => {
    const { db } = getDb();
    const { entries } = await listAuditEvents(db, globexId, { limit: 100 });
    // Acme's failed attempts against Globex must not appear as Globex events.
    expect(entries.map((e) => e.action).sort()).toEqual(["invitation.created", "workspace.created"]);
  });

  it("paginates newest first with a cursor", async () => {
    const { db } = getDb();
    const page1 = await listAuditEvents(db, acmeId, { limit: 2 });
    expect(page1.entries).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listAuditEvents(db, acmeId, { limit: 2, before: new Date(page1.nextCursor!) });
    expect(page2.entries[0]!.createdAt.getTime()).toBeLessThanOrEqual(page1.entries[1]!.createdAt.getTime());
  });

  it("audits server-side member additions once, as a system action", async () => {
    const extra = await signUpAndIn(handler, "server.added@acme.test");
    const extraId = (await getSessionContext(extra.headers))!.user.id;
    const added = await getAuth().api.addMember({
      body: { userId: extraId, role: "agent", organizationId: acmeId },
    });
    const { db } = getDb();
    const { entries } = await listAuditEvents(db, acmeId, { limit: 100 });
    const events = entries.filter((e) => e.action === "member.added");
    // Exactly one: the creator's owner membership on workspace creation is not re-logged.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorType: "system", actorUserId: null, targetId: added!.id });
    expect(entries.filter((e) => e.action === "workspace.created")).toHaveLength(1);
  });
});
