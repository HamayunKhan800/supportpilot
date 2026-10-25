import { count, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuth } from "@/server/platform/auth/auth";
import { DEMO_LOCKED_MESSAGE } from "@/server/platform/auth/demo";
import { getDb } from "@/server/platform/db/client";
import { member, organization, session, ticket, user } from "@/server/platform/db/schema";
import { clearOutbox, createOutboxSender, readOutbox } from "@/server/platform/email/outbox";
import { getEnv } from "@/server/platform/env";
import { stopWebBoss } from "@/server/platform/jobs/boss";
import {
  DEMO_WORKSPACE,
  demoUsers,
  resetDemoWorkspace,
  seedDemoWorkspace,
} from "../../scripts/lib/demo-workspace";
import { loadCorpus } from "../../scripts/lib/kb-corpus";
import { PASSWORD, resetDatabase, TestClient } from "./support/client";

/**
 * Shared demo accounts on the live demo (plan M8 step 2). Visitors all sign in as the same
 * users, so nothing one visitor does may break the demo for the next or outlive the daily reset.
 */
const env = getEnv();
const DOMAIN = env.DEMO_EMAIL_DOMAIN;
// Email on (outbox), so the "never email a demo address" rule is exercised.
const auth = createAuth(getDb().db, env, { email: createOutboxSender() });
const handler = (req: Request) => auth.handler(req);
const corpus = loadCorpus().slice(0, 2);
const [OWNER, ADMIN, AGENT] = demoUsers(DOMAIN).map((u) => u.email) as [string, string, string];

let orgId: string;

async function signIn(email: string, ip = "203.0.113.10") {
  const c = new TestClient(handler, ip);
  const res = await c.post("/sign-in/email", { email, password: PASSWORD });
  expect(res.status).toBe(200);
  await c.post("/organization/set-active", { organizationId: orgId });
  return c;
}

/** A normal account (email on, so it is marked verified as if the code had been entered). */
async function realUser(email: string) {
  const up = await new TestClient(handler).post("/sign-up/email", {
    email,
    password: PASSWORD,
    name: "Real",
  });
  expect(up.status).toBe(200);
  await getDb().db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
  const c = new TestClient(handler);
  expect((await c.post("/sign-in/email", { email, password: PASSWORD })).status).toBe(200);
  return c;
}

beforeAll(async () => {
  await resetDatabase();
  await seedDemoWorkspace(getDb().db, auth, { password: PASSWORD, domain: DOMAIN, corpus });
  [{ id: orgId }] = (await getDb()
    .db.select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, DEMO_WORKSPACE.slug))) as [{ id: string }];
});
afterEach(() => clearOutbox());
afterAll(async () => {
  await stopWebBoss();
});

describe("shared demo accounts can't affect other visitors", () => {
  it("can't change the password, and other visitors stay signed in", async () => {
    const otherVisitor = await signIn(OWNER, "198.51.100.7");
    const visitor = await signIn(OWNER);
    const res = await visitor.post("/change-password", {
      currentPassword: PASSWORD,
      newPassword: "a brand new long passphrase here",
      revokeOtherSessions: true,
    });
    expect(res.status).toBe(403);
    expect(res.json.message).toBe(DEMO_LOCKED_MESSAGE);
    expect((await otherVisitor.get("/get-session")).json?.user.email).toBe(OWNER);
    // The old password still works.
    await signIn(OWNER);
  });

  it("can't sign other visitors out", async () => {
    const otherVisitor = await signIn(AGENT, "198.51.100.8");
    const visitor = await signIn(AGENT);
    const token = (await otherVisitor.get("/get-session")).json.session.token;
    for (const [path, body] of [
      ["/revoke-sessions", {}],
      ["/revoke-other-sessions", {}],
      ["/revoke-session", { token }],
    ] as const) {
      expect((await visitor.post(path, body)).status, path).toBe(403);
    }
    expect((await otherVisitor.get("/get-session")).json?.user.email).toBe(AGENT);
    // Signing yourself out still works.
    expect((await visitor.post("/sign-out")).status).toBe(200);
  });

  it("can't change who is in the workspace or create clutter", async () => {
    const owner = await signIn(OWNER);
    const agentMember = (
      await owner.get("/organization/list-members", { organizationId: orgId })
    ).json.members.find((m: { user: { email: string } }) => m.user.email === AGENT);
    const attempts = [
      ["/organization/invite-member", { email: "me@visitor.test", role: "admin", organizationId: orgId }],
      ["/organization/remove-member", { memberIdOrEmail: agentMember.id, organizationId: orgId }],
      [
        "/organization/update-member-role",
        { memberId: agentMember.id, role: "admin", organizationId: orgId },
      ],
      ["/organization/create", { name: "Visitor Co", slug: "visitor-co" }],
    ] as const;
    for (const [path, body] of attempts) {
      const res = await owner.post(path, body);
      expect(res.status, path).toBe(403);
      expect(res.json.message, path).toBe(DEMO_LOCKED_MESSAGE);
    }
    const agent = await signIn(AGENT);
    expect((await agent.post("/organization/leave", { organizationId: orgId })).status).toBe(403);
    const [members] = await getDb()
      .db.select({ n: count() })
      .from(member)
      .where(eq(member.organizationId, orgId));
    expect(members!.n).toBe(3);
  });

  it("can't link a personal Google or GitHub account", async () => {
    const admin = await signIn(ADMIN);
    expect((await admin.post("/link-social", { provider: "google" })).status).toBe(403);
    expect((await admin.post("/unlink-account", { providerId: "credential" })).status).toBe(403);
  });

  it("nobody can sign up with the demo email domain", async () => {
    const res = await new TestClient(handler).post("/sign-up/email", {
      email: `visitor@${DOMAIN}`,
      password: PASSWORD,
      name: "Visitor",
    });
    expect(res.status).toBe(400);
    expect(
      await getDb()
        .db.select()
        .from(user)
        .where(eq(user.email, `visitor@${DOMAIN}`)),
    ).toHaveLength(0);
  });

  it("never emails a demo address, with the same answer as for anyone else", async () => {
    const res = await new TestClient(handler).post("/request-password-reset", {
      email: OWNER,
      redirectTo: "/reset-password",
    });
    expect(res.status).toBe(200);
    // A normal account gets its email, so the background send has had time to run.
    await realUser("real@person.test");
    clearOutbox();
    await new TestClient(handler).post("/request-password-reset", {
      email: "real@person.test",
      redirectTo: "/reset-password",
    });
    await vi.waitFor(() => expect(readOutbox("real@person.test").length).toBeGreaterThan(0));
    expect(readOutbox(OWNER)).toHaveLength(0);
  });

  it("other accounts keep every one of these actions", async () => {
    const person = await realUser("founder@acme.test");
    expect((await person.post("/organization/create", { name: "Acme", slug: "acme" })).status).toBe(200);
    expect((await person.post("/revoke-other-sessions")).status).toBe(200);
    const changed = await person.post("/change-password", {
      currentPassword: PASSWORD,
      newPassword: "a brand new long passphrase here",
    });
    expect(changed.status).toBe(200);
  });
});

describe("daily demo reset", () => {
  it("puts the demo back as seeded and leaves everything else alone", async () => {
    const { db } = getDb();
    // A visitor's mess: an extra ticket in the demo, and a session that should end.
    await signIn(OWNER);
    const [before] = await db.select({ n: count() }).from(ticket).where(eq(ticket.workspaceId, orgId));
    await db.delete(ticket).where(eq(ticket.workspaceId, orgId));
    const [acme] = await db.select().from(organization).where(eq(organization.slug, "acme"));
    expect(acme).toBeDefined();

    const removed = await resetDemoWorkspace(db, DOMAIN);
    expect(removed).toEqual({ workspaces: 1, users: 3 });
    expect(
      await db
        .select()
        .from(session)
        .innerJoin(user, eq(session.userId, user.id))
        .where(eq(user.email, OWNER)),
    ).toHaveLength(0);

    await seedDemoWorkspace(db, auth, { password: PASSWORD, domain: DOMAIN, corpus });
    const [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_WORKSPACE.slug));
    const [after] = await db.select({ n: count() }).from(ticket).where(eq(ticket.workspaceId, org!.id));
    expect(after!.n).toBe(before!.n);
    const [members] = await db.select({ n: count() }).from(member).where(eq(member.organizationId, org!.id));
    expect(members!.n).toBe(3);
    // Someone else's workspace and account are untouched.
    expect(await db.select().from(organization).where(eq(organization.slug, "acme"))).toHaveLength(1);
    expect(await db.select().from(user).where(eq(user.email, "founder@acme.test"))).toHaveLength(1);
    // The demo password works again.
    orgId = org!.id;
    await signIn(OWNER);
  });
});
