/**
 * Offline fusion experiment (milestones #71, ADR-0014): compares ways to combine vector and
 * keyword search, using only embeddings already in the eval cache. Never calls a provider.
 *
 *   pnpm eval:fusion                                   # Gemini embeddings from eval/cache
 *   pnpm eval:fusion --model mock-hash@768             # mock embeddings (run the mock eval first)
 *
 * Needs DATABASE_URL. Uses a temporary workspace per chunk setting and deletes it afterwards.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import type { ChunkOptions } from "../src/server/modules/kb/chunker";
import { getDb } from "../src/server/platform/db/client";
import { createLogger } from "../src/server/platform/logger";

import { cacheOnlyEmbedder, runFusionEval, type FusionReport } from "./lib/fusion-eval";
import { loadCorpus, loadQuestions } from "./lib/kb-corpus";
import { fileEmbeddingCache } from "./lib/retrieval-eval";

/** The two questions that ask about exact error codes, where keyword search should help. */
const IDENTIFIER_QUESTIONS = ["q061", "q062"];
/** App default, and the best vector setting in the Gemini grid. */
const CHUNKS: ChunkOptions[] = [
  { targetTokens: 500, overlapRatio: 0.15 },
  { targetTokens: 300, overlapRatio: 0 },
];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production");
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL");
  const { values } = parseArgs({
    options: {
      model: { type: "string", default: "gemini-embedding-2@768" },
      cache: { type: "string", default: "eval/cache" },
      out: { type: "string" },
    },
  });
  const embedder = cacheOnlyEmbedder(values.model, fileEmbeddingCache(path.resolve(values.cache)));
  const corpus = loadCorpus();
  const questions = loadQuestions();
  const logger = createLogger({ level: "warn" });
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  const reports: FusionReport[] = [];
  for (const chunk of CHUNKS) {
    const report = await runFusionEval({
      embedder,
      corpus,
      questions,
      chunk,
      watch: IDENTIFIER_QUESTIONS,
      log: (l) => console.log(l),
      logger,
    });
    reports.push(report);
    console.log(
      `\n${values.model}, chunks ${chunk.targetTokens}/${chunk.overlapRatio}, ${report.questions} questions`,
    );
    console.log("| Variant | Recall@5 | MRR@5 | q061 / q062 rank | Better / worse than vector |");
    console.log("|---|---:|---:|---|---|");
    for (const v of report.variants) {
      const watched = IDENTIFIER_QUESTIONS.map((id) => v.watched[id] ?? "miss").join(" / ");
      console.log(
        `| ${v.name} | ${pct(v.recallAtK)} | ${v.mrrAtK.toFixed(3)} | ${watched} | ${v.betterThanVector.length} / ${v.worseThanVector.length} |`,
      );
    }
  }

  if (values.out) {
    const file = path.resolve(values.out);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2)}\n`);
    console.log(`\nWrote ${values.out}`);
  }
  await getDb().pool.end();
}

main().catch(async (err: unknown) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  await getDb()
    .pool.end()
    .catch(() => {});
  process.exitCode = 1;
});
