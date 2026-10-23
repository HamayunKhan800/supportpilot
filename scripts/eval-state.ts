/**
 * Saves or loads evaluation runs, so a multi-day Gemini run survives an empty database
 * (a new GitHub Actions job, a rebuilt local database). See scripts/lib/eval-state.ts.
 *
 *   pnpm eval:state save eval/state/gemini.json     # every Gemini run with its items
 *   pnpm eval:state load eval/state/gemini.json     # then: pnpm eval --provider gemini --resume
 *
 * `save` refuses to write a file that contains the GEMINI_API_KEY of its environment, a last
 * check on top of the runner's own redaction. Needs DATABASE_URL with migrations applied.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { EVAL_PROVIDERS, type EvalProvider } from "../src/server/modules/eval/constants";
import { getDb } from "../src/server/platform/db/client";

import { exportEvalState, importEvalState } from "./lib/eval-state";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { provider: { type: "string", default: "gemini" } },
});

async function main() {
  const [command, file] = positionals;
  if ((command !== "save" && command !== "load") || !file || positionals.length !== 2) {
    throw new Error("Usage: pnpm eval:state save|load <file> [--provider gemini|mock]");
  }
  const provider = EVAL_PROVIDERS.find((p) => p === values.provider);
  if (!provider) throw new Error(`--provider must be one of: ${EVAL_PROVIDERS.join(", ")}`);
  const { db } = getDb();

  if (command === "save") {
    const state = await exportEvalState(db, provider as EvalProvider);
    const text = `${JSON.stringify(state)}\n`;
    const key = process.env.GEMINI_API_KEY;
    if (key && text.includes(key)) throw new Error("Refusing to save: the file would contain the API key");
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    writeFileSync(file, text, { mode: 0o600 });
    console.log(`Saved ${state.runs.length} ${provider} run(s) and ${state.items.length} item(s) to ${file}`);
  } else {
    const result = await importEvalState(db, JSON.parse(readFileSync(file, "utf8")));
    console.log(
      `Loaded ${file}: ${result.runs} new run(s), ${result.runsUpdated} updated, ${result.items} new item(s)`,
    );
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getDb().pool.end());
