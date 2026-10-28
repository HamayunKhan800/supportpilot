import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { evalItem, evalRun } from "@/server/platform/db/schema";
import type { Executor } from "@/server/platform/db/tx";

import type { EvalProvider, EvalRunStatus, EvalSuite } from "./constants";

/**
 * Storage for evaluation runs (M6 D3). Each item is written as soon as it is measured, so a
 * run that stops (call budget, a 429, a crash) keeps everything it measured and can resume.
 */

export type EvalRunRow = typeof evalRun.$inferSelect;
export type EvalItemRow = typeof evalItem.$inferSelect;

export async function createRun(
  db: Executor,
  values: {
    provider: EvalProvider;
    datasetHash: string;
    configHash: string;
    config: Record<string, unknown>;
  },
): Promise<EvalRunRow> {
  const [row] = await db.insert(evalRun).values(values).returning();
  return row!;
}

export async function findRun(db: Executor, id: string): Promise<EvalRunRow | null> {
  const [row] = await db.select().from(evalRun).where(eq(evalRun.id, id)).limit(1);
  return row ?? null;
}

/**
 * The newest run of this provider that has not completed (running means it was interrupted),
 * optionally only among runs with the given settings hash.
 */
export async function findLatestUnfinishedRun(
  db: Executor,
  provider: EvalProvider,
  configHash?: string,
): Promise<EvalRunRow | null> {
  const [row] = await db
    .select()
    .from(evalRun)
    .where(
      and(
        eq(evalRun.provider, provider),
        inArray(evalRun.status, ["running", "stopped"]),
        configHash === undefined ? undefined : eq(evalRun.configHash, configHash),
      ),
    )
    .orderBy(desc(evalRun.startedAt), desc(evalRun.id))
    .limit(1);
  return row ?? null;
}

/** Marks a stopped run as running again for a new session. */
export async function reopenRun(db: Executor, id: string): Promise<void> {
  await db
    .update(evalRun)
    .set({ status: "running", stopReason: null, updatedAt: new Date() })
    .where(eq(evalRun.id, id));
}

export async function saveItem(
  db: Executor,
  runId: string,
  item: {
    suite: EvalSuite;
    itemKey: string;
    passed: boolean;
    failed: boolean;
    result: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(evalItem).values({ runId, ...item });
}

export async function listItems(db: Executor, runId: string): Promise<EvalItemRow[]> {
  return db.select().from(evalItem).where(eq(evalItem.runId, runId)).orderBy(evalItem.createdAt, evalItem.id);
}

/** Deletes the items that failed for technical reasons, so a resumed run measures them again. */
export async function deleteFailedItems(db: Executor, runId: string): Promise<number> {
  const rows = await db
    .delete(evalItem)
    .where(and(eq(evalItem.runId, runId), eq(evalItem.failed, true)))
    .returning({ id: evalItem.id });
  return rows.length;
}

/** Ends a session: records the outcome, adds this session's provider requests. */
export async function endSession(
  db: Executor,
  id: string,
  outcome: {
    status: Exclude<EvalRunStatus, "running">;
    stopReason: string | null;
    calls: number;
    summary: Record<string, unknown>;
  },
): Promise<void> {
  const now = new Date();
  await db
    .update(evalRun)
    .set({
      status: outcome.status,
      stopReason: outcome.stopReason,
      calls: sql`${evalRun.calls} + ${outcome.calls}`,
      summary: outcome.summary,
      updatedAt: now,
      finishedAt: outcome.status === "completed" ? now : null,
    })
    .where(eq(evalRun.id, id));
}

/** What the dashboard shows of a run: no dataset or settings hashes, no items. */
export type EvalRunListing = Pick<
  EvalRunRow,
  | "id"
  | "provider"
  | "status"
  | "calls"
  | "stopReason"
  | "summary"
  | "config"
  | "startedAt"
  | "finishedAt"
  | "updatedAt"
>;

/** The newest runs of one provider, newest first, for the dashboard (M6 step 5). */
export async function listRecentRuns(
  db: Executor,
  provider: EvalProvider,
  limit: number,
): Promise<EvalRunListing[]> {
  return db
    .select({
      id: evalRun.id,
      provider: evalRun.provider,
      status: evalRun.status,
      calls: evalRun.calls,
      stopReason: evalRun.stopReason,
      summary: evalRun.summary,
      config: evalRun.config,
      startedAt: evalRun.startedAt,
      finishedAt: evalRun.finishedAt,
      updatedAt: evalRun.updatedAt,
    })
    .from(evalRun)
    .where(eq(evalRun.provider, provider))
    .orderBy(desc(evalRun.startedAt), desc(evalRun.id))
    .limit(limit);
}

/** One item a run measured as wrong; `result` is the stored JSON, untrusted until parsed. */
export type EvalMissRow = Pick<EvalItemRow, "suite" | "itemKey" | "result">;

/**
 * The items a run got wrong, for "what it got wrong" on the dashboard: not passed, and not a
 * provider failure (an error isn't a wrong answer). Bounded; a full run has 420 items.
 */
export async function listMisses(db: Executor, runId: string, limit = 500): Promise<EvalMissRow[]> {
  return db
    .select({ suite: evalItem.suite, itemKey: evalItem.itemKey, result: evalItem.result })
    .from(evalItem)
    .where(and(eq(evalItem.runId, runId), eq(evalItem.passed, false), eq(evalItem.failed, false)))
    .orderBy(evalItem.suite, evalItem.itemKey)
    .limit(limit);
}

/** How many runs each provider has, so the dashboard can open on the one with results. */
export async function countRunsByProvider(db: Executor): Promise<Partial<Record<EvalProvider, number>>> {
  const rows = await db
    .select({ provider: evalRun.provider, n: sql<string>`count(*)` })
    .from(evalRun)
    .groupBy(evalRun.provider);
  return Object.fromEntries(rows.map((r) => [r.provider, Number(r.n)]));
}
