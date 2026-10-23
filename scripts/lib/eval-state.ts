import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  EVAL_ITEM_KEY_PATTERN,
  EVAL_PROVIDERS,
  EVAL_RUN_STATUSES,
  EVAL_SUITES,
  type EvalProvider,
} from "../../src/server/modules/eval/constants";
import { evalItem, evalRun } from "../../src/server/platform/db/schema";
import type { Database } from "../../src/server/platform/db/client";

/**
 * Moves evaluation runs between databases as one JSON file (M6 step 6).
 *
 * A free-tier Gemini run takes about a week of daily sessions, but each GitHub Actions job
 * starts with an empty database and a local sandbox can lose its database too. So after
 * every session the run's rows are saved to a file (a workflow artifact, or a git-ignored
 * file locally) and loaded before the next one; `pnpm eval --resume` then continues it.
 *
 * Loading is checked field by field (the file may come from an artifact), never deletes
 * anything, and keeps whichever copy of a run was updated last, so loading an older file
 * cannot roll a run back.
 */

export const EVAL_STATE_VERSION = 1;

const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const json = z.record(z.string(), z.unknown());

const runSchema = z.strictObject({
  id: z.uuid(),
  provider: z.enum(EVAL_PROVIDERS),
  status: z.enum(EVAL_RUN_STATUSES),
  datasetHash: hash,
  configHash: hash,
  config: json,
  calls: z.int().min(0),
  stopReason: z.string().max(2000).nullable(),
  summary: json.nullable(),
  startedAt: isoDate,
  updatedAt: isoDate,
  finishedAt: isoDate.nullable(),
});

const itemSchema = z.strictObject({
  id: z.uuid(),
  runId: z.uuid(),
  suite: z.enum(EVAL_SUITES),
  itemKey: z.string().regex(new RegExp(EVAL_ITEM_KEY_PATTERN)),
  passed: z.boolean(),
  failed: z.boolean(),
  result: json,
  createdAt: isoDate,
});

const stateSchema = z
  .strictObject({
    version: z.literal(EVAL_STATE_VERSION),
    savedAt: z.iso.datetime({ offset: true }),
    runs: z.array(runSchema).max(1000),
    items: z.array(itemSchema).max(100_000),
  })
  .refine((s) => s.items.every((i) => s.runs.some((r) => r.id === i.runId)), {
    message: "every item must belong to a run in the file",
  });

export type EvalStateFile = z.input<typeof stateSchema>;

/** Every run of one provider, with all its items. */
export async function exportEvalState(db: Database, provider: EvalProvider): Promise<EvalStateFile> {
  const runs = await db
    .select()
    .from(evalRun)
    .where(eq(evalRun.provider, provider))
    .orderBy(evalRun.startedAt);
  const items = runs.length
    ? await db
        .select()
        .from(evalItem)
        .where(
          inArray(
            evalItem.runId,
            runs.map((r) => r.id),
          ),
        )
        .orderBy(evalItem.createdAt, evalItem.id)
    : [];
  // JSON round trip: dates become ISO strings, the same shape the loader checks.
  return JSON.parse(
    JSON.stringify({ version: EVAL_STATE_VERSION, savedAt: new Date().toISOString(), runs, items }),
  ) as EvalStateFile;
}

/**
 * Loads a saved file. A run already in the database is replaced only by a copy updated
 * later; items are only ever added (a measured item never changes).
 */
export async function importEvalState(
  db: Database,
  input: unknown,
): Promise<{ runs: number; runsUpdated: number; items: number }> {
  const state = stateSchema.parse(input);
  return db.transaction(async (tx) => {
    let runs = 0;
    let runsUpdated = 0;
    for (const run of state.runs) {
      const [row] = await tx
        .insert(evalRun)
        .values(run)
        .onConflictDoUpdate({
          target: evalRun.id,
          set: {
            status: sql`excluded.status`,
            calls: sql`excluded.calls`,
            stopReason: sql`excluded.stop_reason`,
            summary: sql`excluded.summary`,
            updatedAt: sql`excluded.updated_at`,
            finishedAt: sql`excluded.finished_at`,
          },
          // Same run only if it measures the same thing; an older copy never wins.
          setWhere: sql`${evalRun.updatedAt} < excluded.updated_at AND ${evalRun.configHash} = excluded.config_hash AND ${evalRun.datasetHash} = excluded.dataset_hash`,
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      if (row?.inserted) runs++;
      else if (row) runsUpdated++;
    }
    // In batches: Postgres allows at most 65,535 parameters in one statement (8 per item).
    let items = 0;
    for (let i = 0; i < state.items.length; i += 1000) {
      const added = await tx
        .insert(evalItem)
        .values(state.items.slice(i, i + 1000))
        .onConflictDoNothing()
        .returning({ id: evalItem.id });
      items += added.length;
    }
    return { runs, runsUpdated, items };
  });
}
