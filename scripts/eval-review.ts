/**
 * The evaluation Review page's data (M6 D2, docs/plans/m6-evaluation.md).
 *
 *   pnpm eval:review load     put the current review sample into the database
 *   pnpm eval:review status   show how much has been checked
 *   pnpm eval:review export   write the verdicts to eval/review/<set>.json (commit these)
 *
 * `load` is safe to re-run: unchanged items keep their verdicts; an item whose content
 * changed loses its verdict, so the new version gets checked; items no longer in the
 * sample are removed. AI drafts are not touched (they are loaded by the eval runner).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REVIEW_SETS, type ReviewSet } from "../src/server/modules/eval-review/content";
import * as repo from "../src/server/modules/eval-review/repository";
import { getDb } from "../src/server/platform/db/client";
import { transaction } from "../src/server/platform/db/tx";
import { summariseReview } from "./lib/review-export";
import { buildReviewItems } from "./lib/review-items";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REVIEW_DIR = path.join(ROOT, "eval/review");
/** The sets this script owns; drafts come from the eval runner (step 3). */
const DATASET_SETS: ReviewSet[] = ["label-changes", "triage-labels", "retrieval-labels"];

async function load() {
  const seeds = buildReviewItems();
  const result = await transaction((tx) => repo.syncItems(tx, DATASET_SETS, seeds));
  console.log(
    `Review items: ${seeds.length} (${result.inserted} new, ${result.unchanged} unchanged, ` +
      `${result.updated} updated, ${result.reset} changed after review and reset, ${result.removed} removed).`,
  );
}

async function status() {
  const counts = new Map((await repo.countBySet(getDb().db)).map((c) => [c.set, c]));
  for (const set of REVIEW_SETS) {
    const c = counts.get(set);
    console.log(`${set.padEnd(18)} ${c ? `${c.reviewed}/${c.total} checked, ${c.agreed} correct` : "empty"}`);
  }
}

async function exportAll() {
  mkdirSync(REVIEW_DIR, { recursive: true });
  for (const set of REVIEW_SETS) {
    const rows = await repo.listForExport(getDb().db, set);
    if (rows.length === 0) continue;
    const out = summariseReview(set, rows);
    const file = path.join(REVIEW_DIR, `${set}.json`);
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`${path.relative(ROOT, file)}: ${out.summary}`);
    for (const item of out.items.filter((i) => i.verdict === "disagree")) {
      console.log(`  ❌ ${item.key}${item.note ? `: ${item.note}` : ""}`);
    }
  }
}

const commands: Record<string, () => Promise<void>> = { load, status, export: exportAll };

async function main() {
  const command = process.argv[2] ?? "";
  const run = commands[command];
  if (!run) throw new Error(`Usage: pnpm eval:review <${Object.keys(commands).join("|")}>`);
  try {
    await run();
  } finally {
    await getDb().pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
