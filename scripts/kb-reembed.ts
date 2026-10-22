/**
 * Re-embeds a workspace's knowledge base with the configured embedding model (plan D4).
 * Needed after switching AI_PROVIDER (e.g. the demo was seeded with the mock embedder and
 * now runs on Gemini): until then, search answers 409 "embedding_model_mismatch".
 *
 *   AI_PROVIDER=gemini GEMINI_API_KEY=... pnpm kb:reembed --workspace nimbus-demo
 *   pnpm kb:reembed --all
 *
 * Switch the worker to the same provider first, so new uploads use the new model too.
 * Safe to stop and run again: documents already on the new model are skipped.
 */
import { eq } from "drizzle-orm";
import { parseArgs } from "node:util";

import { createEmbedderFromEnv } from "../src/server/modules/kb/embedder";
import { reembedWorkspace } from "../src/server/modules/kb/reembed";
import { getDb } from "../src/server/platform/db/client";
import { organization } from "../src/server/platform/db/schema";

async function main() {
  const { values } = parseArgs({
    options: { workspace: { type: "string" }, all: { type: "boolean", default: false } },
  });
  if (!values.workspace && !values.all) throw new Error("Pass --workspace <slug> or --all");
  const provider = process.env.AI_PROVIDER;
  if (provider !== "mock" && provider !== "gemini") throw new Error("Set AI_PROVIDER to mock or gemini");
  const embedder = createEmbedderFromEnv({
    AI_PROVIDER: provider,
    ...(process.env.GEMINI_API_KEY ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY } : {}),
  });

  const { db } = getDb();
  const workspaces = values.all
    ? await db.select().from(organization)
    : await db.select().from(organization).where(eq(organization.slug, values.workspace!));
  if (workspaces.length === 0) throw new Error(`No workspace with slug "${values.workspace}"`);

  for (const ws of workspaces) {
    const s = await reembedWorkspace(ws.id, embedder, (title, outcome) =>
      console.log(`  ${outcome.status === "reembedded" ? "✓" : `skipped (${outcome.reason})`} ${title}`),
    );
    console.log(
      `${ws.name}: ${s.reembedded} document(s), ${s.chunks} passages now on ${s.model}; ${s.skipped} skipped`,
    );
  }
}

main()
  .then(() => getDb().pool.end())
  .catch(async (err: unknown) => {
    // The message only: an SDK error can carry request details.
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
    await getDb()
      .pool.end()
      .catch(() => {});
    process.exitCode = 1;
  });
