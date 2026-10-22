/**
 * Retrieval eval (plan M4 step 6): recall@5, MRR@5, latency, tokens and cost of the
 * knowledge-base search over the synthetic Nimbus help centre.
 *
 *   pnpm eval:retrieval                          # mock embedder, default chunking, 3 modes
 *   pnpm eval:retrieval --grid                   # chunk 300/500/800 x overlap 0/0.15
 *   GEMINI_API_KEY=... pnpm eval:retrieval --provider gemini --grid --pace-ms 700 \
 *     --out eval/results/retrieval-gemini.json
 *
 * Needs DATABASE_URL (with migrations applied). It creates a temporary workspace per
 * configuration and deletes it afterwards; it never touches other workspaces. Refuses to
 * run with NODE_ENV=production.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { DEFAULT_CHUNK_OPTIONS, type ChunkOptions } from "../src/server/modules/kb/chunker";
import { createGeminiEmbedder, createMockEmbedder } from "../src/server/modules/kb/embedder";
import { getDb } from "../src/server/platform/db/client";
import { createLogger } from "../src/server/platform/logger";

import { loadCorpus, loadQuestions } from "./lib/kb-corpus";
import { EVAL_MODES, type EvalMode, type EvalReport, runRetrievalEval } from "./lib/retrieval-eval";

const GRID: ChunkOptions[] = [300, 500, 800].flatMap((targetTokens) =>
  [0, 0.15].map((overlapRatio) => ({ targetTokens, overlapRatio })),
);

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function formatReport(report: EvalReport): string {
  const lines = [
    `Model: ${report.model} · ${report.documentCount} documents · ${report.questionCount} questions · top ${report.k}`,
    "",
    "| Chunk tokens | Overlap | Chunks | Mode | Recall@5 | MRR@5 | Retrieval p50 / p95 (ms) |",
    "|---:|---:|---:|---|---:|---:|---:|",
  ];
  for (const c of report.configs) {
    for (const m of c.modes) {
      lines.push(
        `| ${c.chunk.targetTokens} | ${c.chunk.overlapRatio} | ${c.chunkCount} | ${m.mode} | ${pct(m.recallAtK)} | ` +
          `${m.mrrAtK.toFixed(3)} | ${m.retrievalMs.p50} / ${m.retrievalMs.p95} |`,
      );
    }
  }
  lines.push("");
  for (const c of report.configs) {
    lines.push(
      `Chunks ${c.chunk.targetTokens}/${c.chunk.overlapRatio}: document embedding p50 ${c.documentEmbedMs.p50} ms, ` +
        `p95 ${c.documentEmbedMs.p95} ms per document; ${c.documentTokens} tokens; ` +
        `evidence split by chunking: ${c.splitEvidence.length ? c.splitEvidence.join(", ") : "none"}`,
    );
  }
  lines.push(
    `Query embedding: p50 ${report.queryEmbedMs.p50} ms, p95 ${report.queryEmbedMs.p95} ms (${report.queryEmbedMs.calls} calls)`,
    `Tokens: ${report.totalTokens} (queries ${report.queryTokens}) · est. cost at paid-tier price: ` +
      `$${(report.estCostMicros / 1e6).toFixed(4)} (free tier: $0)`,
  );
  return lines.join("\n");
}

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Refusing to run the eval with NODE_ENV=production");
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL");
  const { values } = parseArgs({
    options: {
      provider: { type: "string", default: "mock" },
      grid: { type: "boolean", default: false },
      chunk: { type: "string" },
      overlap: { type: "string" },
      modes: { type: "string", default: EVAL_MODES.join(",") },
      "pace-ms": { type: "string", default: "0" },
      out: { type: "string" },
    },
  });

  const provider = values.provider;
  if (provider !== "mock" && provider !== "gemini") throw new Error("--provider must be mock or gemini");
  const modes = values.modes.split(",").map((m) => m.trim()) as EvalMode[];
  if (modes.some((m) => !EVAL_MODES.includes(m)))
    throw new Error(`--modes must be from ${EVAL_MODES.join(",")}`);
  const configs: ChunkOptions[] = values.grid
    ? GRID
    : [
        {
          targetTokens: values.chunk ? Number(values.chunk) : DEFAULT_CHUNK_OPTIONS.targetTokens,
          overlapRatio: values.overlap ? Number(values.overlap) : DEFAULT_CHUNK_OPTIONS.overlapRatio,
        },
      ];

  let embedder;
  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Set GEMINI_API_KEY for --provider gemini");
    embedder = createGeminiEmbedder({ apiKey, maxRetries: 4 });
  } else {
    embedder = createMockEmbedder();
  }

  const corpus = loadCorpus();
  const questions = loadQuestions();
  console.log(
    `Retrieval eval: ${embedder.modelId}, ${configs.length} configuration(s), modes ${modes.join(", ")}`,
  );
  const report = await runRetrievalEval({
    embedder,
    corpus,
    questions,
    configs,
    modes,
    paceMs: Number(values["pace-ms"]),
    log: (line) => console.log(line),
    // Warnings and failures only; one "document ingested" line per document is noise here.
    logger: createLogger({ level: process.env.EVAL_LOG_LEVEL ?? "warn" }),
  });
  console.log(`\n${formatReport(report)}`);

  if (values.out) {
    const file = path.resolve(values.out);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
    console.log(`\nWrote ${path.relative(process.cwd(), file)}`);
  }
}

main()
  .then(() => getDb().pool.end())
  .catch(async (err: unknown) => {
    // The message only: an SDK error can carry request details.
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
    await getDb()
      .pool.end()
      .catch(() => {});
    process.exitCode = 1;
  });
