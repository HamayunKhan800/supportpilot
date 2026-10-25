/**
 * Seeds the public demo workspace "Nimbus Cloud Storage" (scripts/lib/demo-workspace.ts):
 *   DEMO_PASSWORD='a long passphrase' pnpm db:seed-demo           # add what is missing
 *   DEMO_PASSWORD='a long passphrase' pnpm db:seed-demo --reset   # delete the demo, then seed
 *
 * In the container image: node .build/seed-demo.mjs [--reset] (run from /app, which holds
 * eval/corpus/nimbus). The articles are queued for ingestion, so a running worker indexes
 * them within a minute or so. The demo accounts use DEMO_EMAIL_DOMAIN. The password is never
 * stored in the repository. Refuses to run in production unless ALLOW_DEMO_SEED=true.
 */
import path from "node:path";
import { createAuth } from "../src/server/platform/auth/auth";
import { PASSWORD_MIN_LENGTH } from "../src/server/platform/auth/policy";
import { getDb } from "../src/server/platform/db/client";
import { getEnv } from "../src/server/platform/env";
import { stopWebBoss } from "../src/server/platform/jobs/boss";
import { DEMO_WORKSPACE, resetDemoWorkspace, seedDemoWorkspace } from "./lib/demo-workspace";
import { loadCorpus } from "./lib/kb-corpus";

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--reset");
  if (unknown.length) throw new Error(`Unknown option: ${unknown.join(" ")} (only --reset)`);
  const reset = args.includes("--reset");

  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed demo data in production without ALLOW_DEMO_SEED=true");
  }
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Set DEMO_PASSWORD (at least ${PASSWORD_MIN_LENGTH} characters)`);
  }
  const env = getEnv();
  const { db, pool } = getDb();
  // Relative to the working folder, so it works from the repo and from the image's /app.
  const corpus = loadCorpus(path.resolve("eval/corpus/nimbus"));

  if (reset) {
    const removed = await resetDemoWorkspace(db, env.DEMO_EMAIL_DOMAIN);
    console.log(`Reset: deleted ${removed.workspaces} demo workspace(s) and ${removed.users} demo user(s).`);
  }

  // Email off for the seed: the demo addresses can't receive mail, so no codes are sent.
  const auth = createAuth(db, env, { email: null });
  const result = await seedDemoWorkspace(db, auth, { password, domain: env.DEMO_EMAIL_DOMAIN, corpus });
  console.log(`Demo workspace ready: ${DEMO_WORKSPACE.name} (${result.emails.join(", ")})`);
  console.log(
    result.ticketsAdded
      ? `Added ${result.ticketsAdded} demo tickets.`
      : "Tickets already present; none added.",
  );
  console.log(
    result.articlesQueued
      ? `Queued ${result.articlesQueued} help articles for ingestion (start the worker to index them).`
      : "Knowledge base already present; no articles added.",
  );
  await stopWebBoss();
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
