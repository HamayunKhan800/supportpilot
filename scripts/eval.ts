/**
 * The M6 evaluation (plan D3, D4): every dataset through the app's real code paths, with the
 * metrics of docs/04 and a 95% Wilson interval on every rate.
 *
 *   pnpm eval                          # mock models: free, deterministic, a few minutes
 *   pnpm eval --check-floors           # ... and fail below eval/floors.json (CI does this)
 *   GEMINI_API_KEY=... pnpm eval --provider gemini            # on demand, budgeted
 *   GEMINI_API_KEY=... pnpm eval --provider gemini --resume   # continue the stopped run
 *   pnpm eval --triage-prompt v2       # measure another triage prompt (the app keeps its own)
 *
 * Every item is saved to the database (eval_run / eval_item) as soon as it is measured, so a
 * run that stops keeps what it measured; --resume measures only what is missing, and refuses
 * if the datasets, prompts, models or retrieval settings changed in between (it continues the
 * newest unfinished run with the same settings, so a v1 and a v2 run can share days). --retry-failed
 * (with --resume) also measures again the items the provider failed to answer.
 *
 * Gemini sessions are small and slow on purpose, for the free tier: at most --max-calls
 * provider requests (default 60), one at most every --gap-ms (default 7,000), no automatic
 * retries, and a stop at the first "429 too many requests". The whole set takes several
 * sessions, a day apart (the daily quota resets at midnight Pacific time).
 *
 * Writes eval/results/eval-<provider>-<run>.json and .md (the mock run: eval-mock.json/.md, or
 * eval-mock-triage.v2.json/.md for another triage prompt, overwritten each time and not committed). Needs DATABASE_URL with migrations applied.
 * Refuses to run with NODE_ENV=production.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { checkFloors } from "../src/server/modules/eval/metrics";
import {
  isTriagePromptVersion,
  TRIAGE_PROMPT_VERSION,
  TRIAGE_PROMPT_VERSIONS,
} from "../src/server/modules/triage/prompt";
import { getDb } from "../src/server/platform/db/client";

import { createEvalAi } from "./lib/eval-ai";
import { formatMarkdown, type EvalReportFile } from "./lib/eval-report";
import { runConfig, runEval, type EvalDataset } from "./lib/eval-runner";
import { floorValues, loadFloors } from "./lib/eval-summary";
import { loadInjectionCases } from "./lib/injection-cases";
import { loadCorpus, loadQuestions, loadUnanswerable } from "./lib/kb-corpus";
import { loadTriageSet } from "./lib/triage-set";

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "mock" },
    resume: { type: "boolean", default: false },
    run: { type: "string" },
    "retry-failed": { type: "boolean", default: false },
    "max-calls": { type: "string" },
    "gap-ms": { type: "string" },
    "check-floors": { type: "boolean", default: false },
    floors: { type: "string", default: "eval/floors.json" },
    out: { type: "string", default: "eval/results" },
    cache: { type: "string", default: "eval/cache" },
    "triage-prompt": { type: "string", default: "v1" },
  },
});

const int = (name: string, v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
  return n;
};

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production");
  const provider = values.provider;
  if (provider !== "mock" && provider !== "gemini") throw new Error("--provider must be mock or gemini");
  if (values["retry-failed"] && !values.resume) throw new Error("--retry-failed only works with --resume");
  if (values.run && !values.resume) throw new Error("--run only works with --resume");
  const maxCalls = int("max-calls", values["max-calls"] ?? (provider === "gemini" ? "60" : "100000"));
  const gapMs = int("gap-ms", values["gap-ms"] ?? (provider === "gemini" ? "7000" : "0"));
  const floors = values["check-floors"] ? loadFloors(values.floors, provider) : null;
  const triagePrompt = `triage.${values["triage-prompt"]}`;
  if (!isTriagePromptVersion(triagePrompt)) {
    throw new Error(
      `--triage-prompt must be one of: ${TRIAGE_PROMPT_VERSIONS.map((v) => v.slice(7)).join(", ")}`,
    );
  }

  const dataset: EvalDataset = {
    corpus: loadCorpus(),
    triage: loadTriageSet(),
    answerable: loadQuestions(),
    unanswerable: loadUnanswerable(),
    injection: loadInjectionCases(),
  };
  const ai = createEvalAi({
    provider,
    maxCalls,
    gapMs,
    cacheDir: values.cache,
    apiKey: process.env.GEMINI_API_KEY,
  });
  console.log(
    `Provider ${provider}: at most ${maxCalls} provider requests this session, at least ${gapMs} ms apart` +
      (provider === "gemini" ? "; stops at the first 429." : "."),
  );

  const result = await runEval({
    provider,
    metered: ai.metered,
    embedder: ai.embedder,
    dataset,
    config: runConfig({ provider, models: ai.models, embedder: ai.embedder, triagePrompt }),
    resume: values.resume ? (values.run ?? true) : false,
    retryFailed: values["retry-failed"],
    requestsSent: ai.requestsSent,
    redact: ai.redact,
    log: (line) => console.log(ai.redact(line)),
  });

  const failures = floors ? checkFloors(floorValues(result.summary), floors) : [];
  const { run } = result;
  const report: EvalReportFile = {
    run: {
      id: run.id,
      provider: run.provider,
      status: run.status,
      stopReason: run.stopReason,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      calls: run.calls,
      datasetHash: run.datasetHash,
      configHash: run.configHash,
      config: run.config,
    },
    floors: { checked: floors !== null, failures },
    summary: result.summary,
    items: result.items,
  };
  const markdown = formatMarkdown(report);
  // Gemini reports carry the run id; a mock report of another triage prompt gets its own name.
  const variant = triagePrompt === TRIAGE_PROMPT_VERSION ? "" : `-${triagePrompt}`;
  const base = provider === "mock" ? `eval-mock${variant}` : `eval-${provider}-${run.id.slice(0, 8)}`;
  const outDir = path.resolve(values.out);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, `${base}.json`), ai.redact(`${JSON.stringify(report, null, 2)}\n`));
  writeFileSync(path.join(outDir, `${base}.md`), ai.redact(markdown));

  console.log(`\n${markdown}`);
  console.log(
    `This session measured ${result.measured} item(s); ${result.skipped} were already measured; ` +
      `${result.items.length} of ${result.planned} planned items are done.`,
  );
  console.log(`Saved ${path.relative(process.cwd(), path.join(outDir, base))}.json and .md`);
  if (run.status !== "completed") {
    console.log(`The run stopped: ${run.stopReason}. Continue it later with --resume.`);
  }
  if (floors) {
    if (run.status !== "completed") {
      console.error("Floors need a completed run.");
      process.exitCode = 1;
    } else if (failures.length > 0) {
      console.error(`${failures.length} metric(s) outside their floor (see the table above).`);
      process.exitCode = 1;
    } else {
      console.log("Every regression floor passed.");
    }
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getDb().pool.end());
