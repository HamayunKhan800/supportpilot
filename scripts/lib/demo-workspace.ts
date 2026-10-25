/**
 * The public demo workspace "Nimbus Cloud Storage" (scripts/seed-demo.ts): one user per role,
 * 25 synthetic tickets and the synthetic help centre as its knowledge base.
 *
 * Visitors share these accounts, so the live demo is reset once a day (plan M8 step 2):
 * resetDemoWorkspace() deletes the demo workspace (every workspace table cascades from it)
 * and the three demo users (their sessions, sign-ins and memberships cascade), then the
 * normal seed recreates them. Nothing outside the demo workspace and those three users is
 * touched.
 */
import { eq, inArray } from "drizzle-orm";
import type { Auth } from "../../src/server/platform/auth/auth";
import type { Database } from "../../src/server/platform/db/client";
import { member, organization, user } from "../../src/server/platform/db/schema";
import { seedDemoKnowledgeBase } from "../../src/server/modules/kb/demo-seed";
import { seedDemoTickets } from "../../src/server/modules/tickets/demo/seed";
import type { CorpusArticle } from "./kb-corpus";

export const DEMO_WORKSPACE = { name: "Nimbus Cloud Storage", slug: "nimbus-demo" } as const;

const DEMO_USERS = [
  { name: "Olivia Owner", local: "owner", role: "owner" },
  { name: "Adam Admin", local: "admin", role: "admin" },
  { name: "Ayesha Agent", local: "agent", role: "agent" },
] as const;

export function demoUsers(domain: string) {
  return DEMO_USERS.map((u) => ({ name: u.name, role: u.role, email: `${u.local}@${domain}` }));
}

export interface SeedResult {
  emails: string[];
  ticketsAdded: number;
  articlesQueued: number;
}

/**
 * Idempotent: existing users and the workspace are reused, and tickets and articles are only
 * added to a workspace that has none. The accounts are marked as having a verified email
 * (they can't receive mail).
 */
export async function seedDemoWorkspace(
  db: Database,
  auth: Auth,
  options: { password: string; domain: string; corpus: readonly CorpusArticle[] },
): Promise<SeedResult> {
  const users = demoUsers(options.domain);
  const ids: Record<string, string> = {};
  for (const u of users) {
    const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, u.email));
    if (existing) {
      ids[u.role] = existing.id;
      continue;
    }
    const res = await auth.api.signUpEmail({
      body: { name: u.name, email: u.email, password: options.password },
    });
    ids[u.role] = res.user.id;
  }

  // Marked verified so they can sign in when email verification is on. Repeatable, so it also
  // fixes databases seeded before verification existed.
  await db
    .update(user)
    .set({ emailVerified: true })
    .where(
      inArray(
        user.email,
        users.map((u) => u.email),
      ),
    );

  let [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_WORKSPACE.slug));
  if (!org) {
    const created = await auth.api.createOrganization({ body: { ...DEMO_WORKSPACE, userId: ids.owner } });
    [org] = await db.select().from(organization).where(eq(organization.id, created!.id));
  }

  const existingMembers = await db.select().from(member).where(eq(member.organizationId, org!.id));
  for (const u of users.filter((x) => x.role !== "owner")) {
    if (existingMembers.some((m) => m.userId === ids[u.role])) continue;
    await auth.api.addMember({ body: { userId: ids[u.role]!, role: u.role, organizationId: org!.id } });
  }

  const ticketsAdded = await seedDemoTickets(org!.id, {
    owner: ids.owner!,
    admin: ids.admin!,
    agent: ids.agent!,
  });
  // Uploaded by the admin, the role that manages the knowledge base.
  const articlesQueued = await seedDemoKnowledgeBase(org!.id, ids.admin!, options.corpus);
  return { emails: users.map((u) => u.email), ticketsAdded, articlesQueued };
}

/** Deletes the demo workspace and the demo users. Returns what was deleted. */
export async function resetDemoWorkspace(
  db: Database,
  domain: string,
): Promise<{ workspaces: number; users: number }> {
  return db.transaction(async (tx) => {
    const orgs = await tx
      .delete(organization)
      .where(eq(organization.slug, DEMO_WORKSPACE.slug))
      .returning({ id: organization.id });
    const removed = await tx
      .delete(user)
      .where(
        inArray(
          user.email,
          demoUsers(domain).map((u) => u.email),
        ),
      )
      .returning({ id: user.id });
    return { workspaces: orgs.length, users: removed.length };
  });
}
