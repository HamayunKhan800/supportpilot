import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "@/server/platform/auth/auth";
import { getDb } from "@/server/platform/db/client";
import { organization } from "@/server/platform/db/schema";
import { getEnv } from "@/server/platform/env";
import { stopWebBoss } from "@/server/platform/jobs/boss";
import { DEMO_WORKSPACE, demoUsers, seedDemoWorkspace } from "../../scripts/lib/demo-workspace";
import { loadCorpus } from "../../scripts/lib/kb-corpus";
import { PASSWORD, resetDatabase, TestClient } from "./support/client";

/**
 * On Lambda the worker function runs the daily demo reset but can't read the web app's
 * BETTER_AUTH_SECRET, so the seed runs with a throwaway one (scripts/lib/lambda-tasks.ts).
 * This checks the assumption behind that: accounts created under one secret sign in on a
 * web app that has a different secret.
 */
const env = getEnv();
const throwaway = randomBytes(32).toString("base64");
const seedAuth = createAuth(getDb().db, { ...env, BETTER_AUTH_SECRET: throwaway }, { email: null });
const webAuth = createAuth(getDb().db, env, { email: null });
const handler = (req: Request) => webAuth.handler(req);

let orgId: string;

beforeAll(async () => {
  expect(throwaway).not.toBe(env.BETTER_AUTH_SECRET);
  await resetDatabase();
  await seedDemoWorkspace(getDb().db, seedAuth, {
    password: PASSWORD,
    domain: env.DEMO_EMAIL_DOMAIN,
    corpus: loadCorpus().slice(0, 1),
  });
  [{ id: orgId }] = (await getDb()
    .db.select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, DEMO_WORKSPACE.slug))) as [{ id: string }];
});
afterAll(async () => {
  await stopWebBoss();
});

describe("demo seeded with a throwaway auth secret", () => {
  it.each(demoUsers(getEnv().DEMO_EMAIL_DOMAIN).map((u) => [u.role, u.email] as const))(
    "the %s signs in on the web app and opens the demo workspace",
    async (role, email) => {
      const c = new TestClient(handler);
      expect((await c.post("/sign-in/email", { email, password: PASSWORD })).status).toBe(200);
      expect((await c.post("/organization/set-active", { organizationId: orgId })).status).toBe(200);
      const session = (await c.get("/get-session")).json;
      expect(session?.user.email).toBe(email);
      expect(session?.session.activeOrganizationId).toBe(orgId);
      const me = (await c.get("/organization/get-active-member")).json;
      expect(me?.role).toBe(role);
    },
  );

  it("a wrong password is still refused", async () => {
    const [owner] = demoUsers(env.DEMO_EMAIL_DOMAIN);
    const c = new TestClient(handler);
    const res = await c.post("/sign-in/email", { email: owner!.email, password: "not the demo passphrase" });
    expect(res.status).toBe(401);
  });
});
