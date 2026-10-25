/**
 * Background worker process (plan M4 D13, docs/02 §7): `pnpm worker` from source, or
 * `node .build/worker.mjs` from the production image. It processes kb.ingest jobs (the web
 * server never parses uploaded files) and ai.triage jobs.
 *
 * Needs only DATABASE_URL, AI_PROVIDER (+ GEMINI_API_KEY), AI_DAILY_CALL_LIMIT and LOG_LEVEL. Run the release
 * step (`node .build/migrate.mjs`) first: it installs pg-boss's tables and the queues.
 */
import { createAiGatewayFromEnv } from "@/server/modules/ai/gateway";
import { createEmbedderFromEnv } from "@/server/modules/kb/embedder";
import { reserveEmbeddingTexts } from "@/server/modules/kb/repository";
import { mockTriageResponder } from "@/server/modules/triage/mock-responder";
import { getDb } from "@/server/platform/db/client";
import { EnvValidationError, getWorkerEnv, type WorkerEnv } from "@/server/platform/env";
import { setErrorReporter } from "@/server/platform/error-reporting";
import { createBoss } from "@/server/platform/jobs/boss";
import { logger } from "@/server/platform/logger";
import { startTracing, type Tracing } from "@/server/platform/telemetry/setup";

import { registerKbHandlers, registerTriageHandlers } from "./handlers";

// Replaced at bundle time (scripts/bundle.ts) with the bundled PDF thread's file name. When
// run from source it is undefined, and the PDF code uses thread.ts next to itself.
declare const __SP_PDF_THREAD_FILE__: string | undefined;
const pdfThreadUrl =
  typeof __SP_PDF_THREAD_FILE__ === "string"
    ? new URL(`./${__SP_PDF_THREAD_FILE__}`, import.meta.url)
    : undefined;

/**
 * Tracing first, then Sentry (Sentry's guide for an existing OpenTelemetry setup); each is off
 * unless configured (plan M6 D7, D9). Returns what shutdown must flush.
 */
async function startObservability(env: WorkerEnv): Promise<{ flush: () => Promise<void> }> {
  const tracing: Tracing | null = startTracing({ serviceName: "supportpilot-worker", env: process.env });
  let closeSentry: (() => Promise<unknown>) | undefined;
  if (env.SENTRY_DSN) {
    const Sentry = await import("@sentry/node");
    const { buildSentryOptions, sentryReporter } = await import("@/server/platform/telemetry/sentry");
    Sentry.init(
      buildSentryOptions({ ...env, SENTRY_DSN: env.SENTRY_DSN }, () => Sentry.openTelemetryIntegration()),
    );
    setErrorReporter(sentryReporter((err, hint) => Sentry.captureException(err, hint)));
    closeSentry = () => Sentry.close(2_000);
  }
  logger.info(
    { tracing: tracing !== null, errorReporting: Boolean(env.SENTRY_DSN) },
    "observability configured",
  );
  return {
    flush: async () => {
      await Promise.allSettled([tracing?.shutdown(), closeSentry?.()]);
    },
  };
}

async function main(): Promise<void> {
  const env = getWorkerEnv();
  const observability = await startObservability(env);
  // Gemini embeddings count against the deployment-wide daily cap (plan M8 step 2).
  const embedder = createEmbedderFromEnv(env, (texts) =>
    reserveEmbeddingTexts(getDb().db, texts, env.AI_DAILY_EMBEDDING_LIMIT),
  );
  const boss = createBoss(env.DATABASE_URL, "worker", 4);
  // A few attempts so the worker can start alongside a database that is still booting.
  await boss.start({ attempts: 5 });
  await registerKbHandlers(boss, { embedder, prepare: { pdf: { threadUrl: pdfThreadUrl } } });
  // One gateway per process: its circuit breakers must see every call this worker makes.
  const gateway = createAiGatewayFromEnv(env, getDb().db, { triage: mockTriageResponder });
  await registerTriageHandlers(boss, { gateway });
  logger.info({ provider: env.AI_PROVIDER, model: embedder.modelId }, "worker started");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker stopping");
    // Graceful: running jobs may finish; unfinished ones are retried by another worker.
    await boss.stop({ graceful: true, timeout: env.WORKER_SHUTDOWN_TIMEOUT_MS });
    await getDb().pool.end();
    await observability.flush(); // last spans and error reports
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
