/**
 * Background worker process (plan M4 D13, docs/02 §7): `pnpm worker` from source, or
 * `node .build/worker.mjs` from the production image. It processes kb.ingest jobs. The
 * web server never parses uploaded files.
 *
 * Needs only DATABASE_URL, AI_PROVIDER (+ GEMINI_API_KEY) and LOG_LEVEL. Run the release
 * step (`node .build/migrate.mjs`) first: it installs pg-boss's tables and the queues.
 */
import { createEmbedderFromEnv } from "@/server/modules/kb/embedder";
import { getDb } from "@/server/platform/db/client";
import { EnvValidationError, getWorkerEnv } from "@/server/platform/env";
import { createBoss } from "@/server/platform/jobs/boss";
import { logger } from "@/server/platform/logger";

import { registerKbHandlers } from "./handlers";

// Replaced at bundle time (scripts/bundle.ts) with the bundled PDF thread's file name. When
// run from source it is undefined, and the PDF code uses thread.ts next to itself.
declare const __SP_PDF_THREAD_FILE__: string | undefined;
const pdfThreadUrl =
  typeof __SP_PDF_THREAD_FILE__ === "string"
    ? new URL(`./${__SP_PDF_THREAD_FILE__}`, import.meta.url)
    : undefined;

const SHUTDOWN_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  const env = getWorkerEnv();
  const embedder = createEmbedderFromEnv(env);
  const boss = createBoss(env.DATABASE_URL, "worker", 4);
  // A few attempts so the worker can start alongside a database that is still booting.
  await boss.start({ attempts: 5 });
  await registerKbHandlers(boss, { embedder, prepare: { pdf: { threadUrl: pdfThreadUrl } } });
  logger.info({ provider: env.AI_PROVIDER, model: embedder.modelId }, "worker started");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker stopping");
    // Graceful: running jobs may finish; unfinished ones are retried by another worker.
    await boss.stop({ graceful: true, timeout: SHUTDOWN_TIMEOUT_MS });
    await getDb().pool.end();
    logger.info("worker stopped");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  if (err instanceof EnvValidationError) {
    logger.fatal({ issues: err.issues }, "invalid worker configuration");
  } else {
    // Message only: connection errors can include connection details.
    logger.fatal(
      { err: { message: err instanceof Error ? err.message : String(err) } },
      "worker failed to start",
    );
  }
  process.exit(1);
});
