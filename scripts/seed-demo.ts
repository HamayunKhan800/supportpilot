/**
 * Seeds the public demo workspace "Nimbus Cloud Storage" with one user per role.
 *   DEMO_PASSWORD='a long passphrase' pnpm db:seed-demo
 * Idempotent: existing users and the workspace are reused. The password is never stored
 * in the repository. Refuses to run in production unless ALLOW_DEMO_SEED=true.
 */
import { eq } from "drizzle-orm";
import { getAuth } from "../src/server/platform/auth";
import { getDb } from "../src/server/platform/db/client";
import { member, organization, user } from "../src/server/platform/db/schema";
import { PASSWORD_MIN_LENGTH } from "../src/server/platform/auth/policy";

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
  const auth = getAuth();
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

  console.log(`Demo workspace ready: ${WORKSPACE.name} (${USERS.map((u) => u.email).join(", ")})`);
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
