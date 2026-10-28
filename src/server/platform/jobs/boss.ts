import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss } from "pg-boss";

import { pgConnectionConfig } from "../db/connection";
import type { Executor, Transaction } from "../db/tx";
import { getDatabaseEnv } from "../env";
import { logger } from "../logger";
import { wakeWorker } from "./wake";
import {
  AI_TRIAGE_QUEUE,
  aiTriagePayloadSchema,
  KB_INGEST_QUEUE,
  kbIngestPayloadSchema,
  QUEUE_INSTALL_ORDER,
  QUEUE_SETTINGS,
  type AiTriagePayload,
  type KbIngestPayload,
  type QueueSettings,
} from "./queues";

/**
 * pg-boss wiring (ADR-0005). Three roles share one schema:
 *  - installer (release step, `scripts/migrate.ts`): the only role that creates or
 *    upgrades pg-boss's tables, and it applies the queue settings from queues.ts;
 *  - worker: processes jobs and runs pg-boss's supervision (expiry, retries, heartbeats);
 *  - web: only enqueues, always inside the caller's transaction, with a 2-connection pool,
 *    and wakes the worker when it runs on demand (wake.ts).
 */

export const PGBOSS_SCHEMA = "pgboss";

export type BossRole = "installer" | "worker" | "web";

export function createBoss(connectionString: string, role: BossRole, max = 2): PgBoss {
  const boss = new PgBoss({
    // pg-boss hands its whole config to pg.Pool (pg-boss dist/db.js), so the channel-binding
    // option reaches the driver although pg-boss's types don't list it.
    ...pgConnectionConfig(connectionString),
    schema: PGBOSS_SCHEMA,
    application_name: `supportpilot-${role}`,
    max,
    migrate: role === "installer",
    supervise: role === "worker",
    schedule: false,
  });
  // pg-boss reports background failures (e.g. a lost connection) as events. Log the
  // message only: driver errors can include connection details.
  boss.on("error", (err: Error) => logger.error({ role, err: { message: err.message } }, "job queue error"));
  boss.on("warning", (w: { message: string }) =>
    logger.warn({ role, warning: w.message }, "job queue warning"),
  );
  return boss;
}

/** Creates missing queues and updates existing ones, so code is the source of truth. */
export async function ensureQueues(
  boss: PgBoss,
  settings: Record<string, QueueSettings> = QUEUE_SETTINGS,
): Promise<void> {
  for (const name of QUEUE_INSTALL_ORDER) {
    const queue = settings[name];
    if (!queue) throw new Error(`No settings for queue ${name}`);
    if (await boss.getQueue(name)) await boss.updateQueue(name, queue);
    else await boss.createQueue(name, queue);
  }
}

/** Release step: installs or upgrades pg-boss's schema and applies queue settings. */
export async function installJobs(
  connectionString: string,
  settings: Record<string, QueueSettings> = QUEUE_SETTINGS,
): Promise<void> {
  const boss = createBoss(connectionString, "installer");
  await boss.start();
  try {
    await ensureQueues(boss, settings);
  } finally {
    await boss.stop({ graceful: false });
  }
}

// One started enqueue-only instance per web process (reused across hot reloads).
const globalForBoss = globalThis as unknown as { __spWebBoss?: Promise<PgBoss> };

function getWebBoss(): Promise<PgBoss> {
  if (!globalForBoss.__spWebBoss) {
    const boss = createBoss(getDatabaseEnv().DATABASE_URL, "web");
    globalForBoss.__spWebBoss = boss.start().catch((err: unknown) => {
      globalForBoss.__spWebBoss = undefined; // let the next request try again
      throw err;
    });
  }
  return globalForBoss.__spWebBoss;
}

/**
 * Enqueues document ingestion inside the caller's transaction: if the transaction rolls
 * back, the job disappears with it, and a committed document always has its job (D9).
 */
export async function enqueueKbIngest(tx: Transaction, payload: KbIngestPayload): Promise<string> {
  const boss = await getWebBoss();
  const id = await boss.send(KB_INGEST_QUEUE, kbIngestPayloadSchema.parse(payload), {
    db: fromDrizzle(tx, sql),
  });
  if (!id) throw new Error("kb.ingest job was not created");
  await wakeWorker();
  return id;
}

/**
 * Queues AI triage for a new ticket (M5 D4) inside the caller's transaction, so the job
 * exists if and only if the ticket does.
 */
export async function enqueueTriage(tx: Transaction, payload: AiTriagePayload): Promise<string> {
  const boss = await getWebBoss();
  const id = await boss.send(AI_TRIAGE_QUEUE, aiTriagePayloadSchema.parse(payload), {
    db: fromDrizzle(tx, sql),
  });
  if (!id) throw new Error("ai.triage job was not created");
  await wakeWorker();
  return id;
}

export interface PendingJobs {
  /** Waiting jobs that may run now. */
  ready: number;
  /** Jobs a worker is running. */
  active: number;
  /** When the earliest waiting job that may not run yet (a retry after a delay) becomes due. */
  nextRetryAt: Date | null;
}

/**
 * Unfinished work in the given queues, read straight from pg-boss's job table (the root of
 * its table hierarchy, so it covers every queue's storage). pg-boss's own counters are a
 * cache refreshed by its monitor, too stale to decide when a worker may stop (drain mode).
 */
export async function pendingJobs(db: Executor, queues: readonly string[]): Promise<PendingJobs> {
  const result = await db.execute<{ ready: number; active: number; next_retry_at: Date | string | null }>(sql`
    SELECT
      count(*) FILTER (WHERE state IN ('created', 'retry') AND start_after <= now())::int AS ready,
      count(*) FILTER (WHERE state = 'active')::int AS active,
      min(start_after) FILTER (WHERE state IN ('created', 'retry') AND start_after > now()) AS next_retry_at
    FROM ${sql.identifier(PGBOSS_SCHEMA)}.job
    WHERE name = ANY(${sql.param([...queues])}::text[])
  `);
  const row = result.rows[0];
  return {
    ready: Number(row?.ready ?? 0),
    active: Number(row?.active ?? 0),
    nextRetryAt: row?.next_retry_at ? new Date(row.next_retry_at) : null,
  };
}

/** Test and shutdown helper: stops the web enqueue instance if one was started. */
export async function stopWebBoss(): Promise<void> {
  const pending = globalForBoss.__spWebBoss;
  globalForBoss.__spWebBoss = undefined;
  if (pending) await (await pending).stop({ graceful: false });
}
