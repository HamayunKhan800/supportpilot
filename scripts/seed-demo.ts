/**
 * Seeds the public demo workspace "Nimbus Cloud Storage" with one user per role,
 * 25 synthetic tickets (src/server/modules/tickets/demo/tickets.ts) and the synthetic help
 * centre (eval/corpus/nimbus) as its knowledge base. The articles are queued for ingestion,
 * so a running worker indexes them within a minute or so.
 *   DEMO_PASSWORD='a long passphrase' pnpm db:seed-demo
 * Idempotent: existing users and the workspace are reused, and tickets and articles are
 * only added to a workspace that has none. The password is never stored
 * in the repository. Refuses to run in production unless ALLOW_DEMO_SEED=true.
 * The demo accounts are marked as having a verified email (they can't receive mail).
 */
import { eq, inArray } from "drizzle-orm";
import { createAuth } from "../src/server/platform/auth/auth";
import { getDb } from "../src/server/platform/db/client";
import { getEnv } from "../src/server/platform/env";
import { member, organization, user } from "../src/server/platform/db/schema";
import { PASSWORD_MIN_LENGTH } from "../src/server/platform/auth/policy";
import { seedDemoTickets } from "../src/server/modules/tickets/demo/seed";
import { seedDemoKnowledgeBase } from "../src/server/modules/kb/demo-seed";
import { stopWebBoss } from "../src/server/platform/jobs/boss";
import { loadCorpus } from "./lib/kb-corpus";

const WORKSPACE = { name: "Nimbus Cloud Storage", slug: "nimbus-demo" };
const USERS = [
  { name: "Olivia Owner", email: "owner@demo.supportpilot.dev", role: "owner" },
  { name: "Adam Admin", email: "admin@demo.supportpilot.dev", role: "admin" },
  { name: "Ayesha Agent", email: "agent@demo.supportpilot.dev", role: "agent" },
] as const;

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed demo data in production without ALLOW_DEMO_SEED=true");
  }
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Set DEMO_PASSWORD (at least ${PASSWORD_MIN_LENGTH} characters)`);
  }
  // Email off for the seed: the demo addresses can't receive mail, so no codes are sent.
  const auth = createAuth(getDb().db, getEnv(), { email: null });
  const { db, pool } = getDb();

  const ids: Record<string, string> = {};
  for (const u of USERS) {
    const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, u.email));
    if (existing) {
      ids[u.role] = existing.id;
      continue;
    }
    const res = await auth.api.signUpEmail({ body: { name: u.name, email: u.email, password } });
    ids[u.role] = res.user.id;
  }

  // The demo accounts are marked verified so they can sign in when email verification is on.
  // Repeatable, so it also fixes databases seeded before verification existed.
  await db
    .update(user)
    .set({ emailVerified: true })
    .where(
      inArray(
        user.email,
        USERS.map((u) => u.email),
      ),
    );

  let [org] = await db.select().from(organization).where(eq(organization.slug, WORKSPACE.slug));
  if (!org) {
    const created = await auth.api.createOrganization({ body: { ...WORKSPACE, userId: ids.owner } });
    [org] = await db.select().from(organization).where(eq(organization.id, created!.id));
  }

  const existingMembers = await db.select().from(member).where(eq(member.organizationId, org!.id));
  for (const u of USERS.filter((x) => x.role !== "owner")) {
    if (existingMembers.some((m) => m.userId === ids[u.role])) continue;
    await auth.api.addMember({ body: { userId: ids[u.role]!, role: u.role, organizationId: org!.id } });
  }

  const added = await seedDemoTickets(org!.id, { owner: ids.owner!, admin: ids.admin!, agent: ids.agent! });
  console.log(`Demo workspace ready: ${WORKSPACE.name} (${USERS.map((u) => u.email).join(", ")})`);
  console.log(added ? `Added ${added} demo tickets.` : "Tickets already present; none added.");
  // Uploaded by the admin, the role that manages the knowledge base.
  const articles = await seedDemoKnowledgeBase(org!.id, ids.admin!, loadCorpus());
  console.log(
    articles
      ? `Queued ${articles} help articles for ingestion (start the worker to index them).`
      : "Knowledge base already present; no articles added.",
  );
  await stopWebBoss();
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
