/**
 * Refusal threshold analysis (M6 D6b): the best vector similarity the app's search finds for
 * each of the 110 answerable and 30 unanswerable questions, with Gemini embeddings, and what
 * every candidate `retrieval_min_score` would do with them.
 *
 *   pnpm eval:threshold        # Gemini embeddings from eval/cache; never calls a provider
 *
 * Uses only embeddings already in the cache (paid for in M4's free-tier quota); a missing one
 * is an error, not an API call. Needs DATABASE_URL; works in a temporary workspace that it
 * deletes. Writes eval/results/threshold-gemini.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { topVectorScore } from "../src/server/modules/drafts/service";
import { DEFAULT_CHUNK_OPTIONS } from "../src/server/modules/kb/chunker";
import { GEMINI_EMBEDDING_MODEL } from "../src/server/modules/kb/embedder";
import { DEFAULT_RETRIEVAL_MIN_SCORE } from "../src/server/modules/kb/retrieval";
import { hybridSearch } from "../src/server/modules/kb/service";
import { getDb } from "../src/server/platform/db/client";
import { EMBEDDING_DIMENSIONS } from "../src/server/platform/db/schema";
import { formatRate } from "../src/server/modules/eval/stats";

import { cacheOnlyEmbedder } from "./lib/fusion-eval";
import { loadCorpus, loadQuestions, loadUnanswerable } from "./lib/kb-corpus";
import { fileEmbeddingCache, setUpEvalWorkspace } from "./lib/retrieval-eval";
import {
  chooseThreshold,
  GATE_MAX_FALSE_REFUSAL,
  summarizeScores,
  sweep,
  type ScoredQuestion,
} from "./lib/threshold";

const { values } = parseArgs({
  options: {
    cache: { type: "string", default: "eval/cache" },
    out: { type: "string", default: "eval/results/threshold-gemini.json" },
  },
});

/** M5's value (finding #87), to show what the M6 analysis changed. */
const M5_VALUE = 0.65;

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production");
  const modelId = `${GEMINI_EMBEDDING_MODEL}@${EMBEDDING_DIMENSIONS}`;
  const embedder = cacheOnlyEmbedder(modelId, fileEmbeddingCache(path.resolve(values.cache)));
  const corpus = loadCorpus();
  const answerable = loadQuestions();
  const unanswerable = loadUnanswerable();

  const ws = await setUpEvalWorkspace(DEFAULT_CHUNK_OPTIONS, {
    corpus,
    questions: answerable,
    embedder,
    log: (l) => console.log(l),
  });
  const scores: ScoredQuestion[] = [];
  try {
    for (const [set, list] of [
      ["answerable", answerable],
      ["unanswerable", unanswerable],
    ] as const) {
      for (const q of list) {
        const res = await hybridSearch(ws.workspaceId, q.question, embedder);
        const top = topVectorScore(res.results);
        scores.push({ id: q.id, set, topScore: top === null ? null : Math.round(top * 10000) / 10000 });
      }
    }
  } finally {
    await ws.remove();
  }

  const rows = sweep(scores);
  const chosen = chooseThreshold(rows);
  const m5 = rows.find((r) => r.threshold === M5_VALUE)!;
  const current = rows.find((r) => r.threshold === DEFAULT_RETRIEVAL_MIN_SCORE)!;
  const report = {
    model: modelId,
    chunk: DEFAULT_CHUNK_OPTIONS,
    rule:
      `gate false refusals <= ${GATE_MAX_FALSE_REFUSAL * 100}% of answerable questions; then most unanswerable ` +
      "refused; then fewest answerable refused; then the middle of the tied range",
    answerableTopScores: summarizeScores(scores.filter((s) => s.set === "answerable").map((s) => s.topScore)),
    unanswerableTopScores: summarizeScores(
      scores.filter((s) => s.set === "unanswerable").map((s) => s.topScore),
    ),
    m5,
    currentDefault: current,
    chosen,
    sweep: rows,
    scores,
  };
  const out = path.resolve(values.out);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  const line = (r: (typeof rows)[number]) =>
    `  ${r.threshold.toFixed(2)}  answerable refused ${formatRate(r.falseRefusal, 1).padEnd(26)} unanswerable refused ${formatRate(r.refusalRecall, 1)}`;
  console.log(`\nBest-score spread, answerable:   ${JSON.stringify(report.answerableTopScores)}`);
  console.log(`Best-score spread, unanswerable: ${JSON.stringify(report.unanswerableTopScores)}\n`);
  for (const r of rows.filter((r) => Math.round(r.threshold * 100) % 5 === 0)) console.log(line(r));
  console.log(`\nM5 value (${M5_VALUE}):`);
  console.log(line(m5));
  console.log(`Default in the code (${DEFAULT_RETRIEVAL_MIN_SCORE}):`);
  console.log(line(current));
  console.log(`Rule: ${report.rule}`);
  console.log(chosen ? `Chosen:\n${line(chosen)}` : "No threshold meets the rule.");
  console.log(`\nSaved ${path.relative(process.cwd(), out)}`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getDb().pool.end());
