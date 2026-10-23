/**
 * AI smoke run (plan M5 step 6): triage, drafts and the prompt-injection set against the real
 * pipelines, measuring quality, latency, tokens and cost.
 *
 *   pnpm eval:ai                                   # mock model: a free dry run of the harness
 *   GEMINI_API_KEY=... pnpm eval:ai --provider gemini --out eval/results/ai-smoke-gemini.json
 *
 * Gemini runs are deliberately small and slow: about 60 generation calls, one at most every
 * 7 seconds (--gap-ms), a hard stop at --max-calls (default 75), no automatic retries, and
 * the run ends at the first "429 too many requests" instead of retrying. Results are saved
 * after every item, so a stopped run keeps what it measured. Embeddings come from the M4
 * cache (eval/cache) where possible; new ones are rate-limited as in the retrieval eval.
 *
 * Needs DATABASE_URL (migrations applied). Works in a temporary workspace that it deletes
 * afterwards. Refuses to run with NODE_ENV=production.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { DEMO_TICKETS } from "../src/server/modules/tickets/demo/tickets";
import { getDb } from "../src/server/platform/db/client";

import { runAiSmoke, spreadPick, type AiSmokeReport } from "./lib/ai-smoke";
import { createEvalAi } from "./lib/eval-ai";
import { loadInjectionCases } from "./lib/injection-cases";
import { loadCorpus, loadQuestions, loadUnanswerable } from "./lib/kb-corpus";

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "mock" },
    out: { type: "string" },
    "max-calls": { type: "string", default: "75" },
    "gap-ms": { type: "string" },
    triage: { type: "string", default: "20" },
    answerable: { type: "string", default: "10" },
    unanswerable: { type: "string", default: "10" },
    cache: { type: "string", default: "eval/cache" },
  },
});

const int = (name: string, v: string | undefined) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
  return n;
};

const usd = (n: number | null) => (n === null ? "n/a" : `$${n.toFixed(6)}`);
const ms = (s: { p50: number | null; p95: number | null; n: number }) =>
  s.n ? `p50 ${s.p50} ms, p95 ${s.p95} ms (n=${s.n})` : "n/a";

export function formatSummary(report: AiSmokeReport): string {
  const s = report.summary;
  return [
    `Provider: ${report.provider} · models: triage ${report.models.triage ?? "n/a"}, draft ${report.models.draft ?? "n/a"}`,
    `Calls: ${s.cost.calls} (${s.cost.failedCalls} failed)${report.stopReason ? ` · STOPPED: ${report.stopReason}` : ""}`,
    "",
    `Triage: ${s.triage.succeeded}/${s.triage.run} succeeded · category ${s.triage.categoryAccuracyPct ?? "n/a"}% · priority ${s.triage.priorityAccuracyPct ?? "n/a"}% · needs review ${s.triage.needsReview} · ${ms(s.triage.latencyMs)}`,
    `Drafts (answerable): ${s.drafts.answerableReady}/${s.drafts.answerable} ready · ${s.drafts.answerableCitingGold} cite the right article`,
    `Drafts (unanswerable): ${s.drafts.unanswerableRefused}/${s.drafts.unanswerable} refused · ${s.drafts.refusedBeforeModel} refusals made no model call`,
    `Citations removed as invalid: ${s.drafts.invalidCitationsRemoved} · truncated drafts: ${s.drafts.truncated}`,
    `Drafts by model: ${
      Object.entries(s.drafts.byModel)
        .map(([m, n]) => `${m} ${n}`)
        .join(", ") || "none"
    }`,
    `Draft time to first token: ${ms(s.drafts.ttftMs)} · model time: ${ms(s.drafts.modelLatencyMs)} · end to end: ${ms(s.drafts.endToEndMs)}`,
    `Injection: ${s.injection.reachedModel}/${s.injection.cases} reached the model · obeyed ${s.injection.obeyed} · of those caught by code ${s.injection.obeyedCaughtByCode} · reached the agent unflagged: ${s.injection.obeyedReachedAgentUnflagged.join(", ") || "none"}`,
    `Tokens: ${s.cost.inputTokens} in / ${s.cost.outputTokens} out · est. cost at paid-tier prices ${usd(s.cost.estCostUsd)} (free tier: $0) · per triage ${usd(s.cost.perTriageUsd)} · per draft ${usd(s.cost.perDraftUsd)}`,
  ].join("\n");
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production");
  const provider = values.provider;
  if (provider !== "mock" && provider !== "gemini") throw new Error("--provider must be mock or gemini");
  const maxCalls = int("max-calls", values["max-calls"]);
  const gapMs = int("gap-ms", values["gap-ms"] ?? (provider === "gemini" ? "7000" : "0"));

  const triageKeys = spreadPick(DEMO_TICKETS, int("triage", values.triage)).map((t) => t.key);
  const answerable = spreadPick(loadQuestions(), int("answerable", values.answerable));
  const unanswerable = spreadPick(loadUnanswerable(), int("unanswerable", values.unanswerable));
  const injection = loadInjectionCases();
  const planned = triageKeys.length + answerable.length + unanswerable.length + injection.length;
  if (planned > maxCalls) {
    throw new Error(`The run plans ${planned} calls, more than --max-calls ${maxCalls}`);
  }

  const ai = createEvalAi({
    provider,
    maxCalls,
    gapMs,
    cacheDir: values.cache,
    apiKey: process.env.GEMINI_API_KEY,
  });
  const { metered, embedder } = ai;

  console.log(
    `Planned: ${triageKeys.length} triage, ${answerable.length} answerable and ${unanswerable.length} unanswerable drafts, ` +
      `${injection.length} injection cases (${planned} calls at most, plus triage's one retry on invalid output; ` +
      `hard stop at ${maxCalls}); at least ${gapMs} ms between calls`,
  );
  const out = values.out ? path.resolve(values.out) : null;
  const save = (report: AiSmokeReport) => {
    if (!out) return;
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  };
  const report = await runAiSmoke({
    metered,
    embedder,
    corpus: loadCorpus(),
    triageKeys,
    answerable,
    unanswerable,
    injection,
    log: (line) => console.log(line),
    onProgress: save,
  });
  save(report);
  console.log(`\n${formatSummary(report)}`);
  console.log(`Provider requests (fallbacks included): ${ai.requestsSent()} of at most ${maxCalls}`);
  if (out) console.log(`\nSaved ${path.relative(process.cwd(), out)}`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getDb().pool.end());
