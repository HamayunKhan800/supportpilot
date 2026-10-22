/**
 * Retrieval eval (plan M4 step 6): recall@5, MRR@5, latency, tokens and cost of the
 * knowledge-base search over the synthetic Nimbus help centre.
 *
 *   pnpm eval:retrieval                          # mock embedder, default chunking, 3 modes
 *   pnpm eval:retrieval --grid                   # chunk 300/500/800 x overlap 0/0.15
 *   GEMINI_API_KEY=... pnpm eval:retrieval --provider gemini --grid \
 *     --out eval/results/retrieval-gemini.json
 *
 * Gemini runs send at most 80 texts per rolling minute (--max-per-minute; the free tier
 * allows 100 and counts each text in a batch) and make no automatic retries (--retries).
 *
 * Embeddings are cached in eval/cache (git-ignored), so each passage and question is only
 * ever embedded once; later runs and experiments reuse them without API calls (--no-cache
 * to disable). Gemini runs refuse to start if they need more new embeddings than --budget
 * (default 900): the free tier allows 1,000 embedded texts per day and counts each passage.
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
import { createTextRateLimiter } from "./lib/rate-limit";
import { getDb } from "../src/server/platform/db/client";
import { createLogger } from "../src/server/platform/logger";

import { loadCorpus, loadQuestions, loadUnanswerable } from "./lib/kb-corpus";
import {
  EVAL_MODES,
  type EvalMode,
  type EvalReport,
  evalDiagnostics,
  fileEmbeddingCache,
  memoryEmbeddingCache,
  runRetrievalEval,
} from "./lib/retrieval-eval";
import { formatUnanswerableReview, withoutPassageText } from "./lib/unanswerable-review";

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
    const embedMs = c.documentTokens
      ? `document embedding p50 ${c.documentEmbedMs.p50} ms, p95 ${c.documentEmbedMs.p95} ms per call`
      : "all passages from the cache";
    lines.push(
      `Chunks ${c.chunk.targetTokens}/${c.chunk.overlapRatio}: ${embedMs}; ${c.documentTokens} new tokens; ` +
        `evidence split by chunking: ${c.splitEvidence.length ? c.splitEvidence.join(", ") : "none"}`,
    );
  }
  lines.push(
    `Query embedding: p50 ${report.queryEmbedMs.p50} ms, p95 ${report.queryEmbedMs.p95} ms (${report.queryEmbedMs.calls} calls)`,
    `Embedded texts sent: ${report.embeddedTexts} · cache hits: ${report.cacheHits}`,
    `Tokens sent: ${report.totalTokens} (queries ${report.queryTokens}) · est. cost at paid-tier price: ` +
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
      "max-per-minute": { type: "string" },
      "max-tokens-per-minute": { type: "string" },
      "max-batch": { type: "string" },
      retries: { type: "string" },
      out: { type: "string" },
      cache: { type: "string", default: "eval/cache" },
      "no-cache": { type: "boolean", default: false },
      budget: { type: "string" },
      "no-unanswerable": { type: "boolean", default: false },
      review: { type: "string" },
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
    // No automatic retries by default: each retry after "too many requests" is another
    // request that counts against the free tier's limits. A failed run keeps its saved
    // results and embedding cache, so running it again resumes where it stopped.
    embedder = createGeminiEmbedder({ apiKey, maxRetries: values.retries ? Number(values.retries) : 0 });
  } else {
    embedder = createMockEmbedder();
  }

  // Gemini free tier for gemini-embedding-2 (AI Studio, 2026-10-22): 100 texts and 30,000
  // tokens per minute. Defaults use half of each, in small evenly spaced batches (#85, #86).
  const num = (v: string | undefined, gemini: number) =>
    v !== undefined ? Number(v) : provider === "gemini" ? gemini : undefined;
  const maxPerMinute = num(values["max-per-minute"], 50);
  const maxTokensPerMinute = num(values["max-tokens-per-minute"], 15_000);
  const maxBatch = num(values["max-batch"], 10);
  const rateLimiter = maxPerMinute
    ? createTextRateLimiter({
        maxPerMinute,
        even: true,
        ...(maxTokensPerMinute ? { maxTokensPerMinute } : {}),
        ...(maxBatch ? { maxBatch: Math.min(maxBatch, maxPerMinute) } : {}),
      })
    : undefined;
  if (rateLimiter)
    console.log(
      `Rate limit: ${maxPerMinute} texts${maxTokensPerMinute ? ` and ~${maxTokensPerMinute} tokens` : ""} per minute, evenly spaced, batches of up to ${rateLimiter.maxBatch}`,
    );

  const budget =
    values.budget !== undefined ? Number(values.budget) : provider === "gemini" ? 900 : undefined;
  const cache = values["no-cache"] ? memoryEmbeddingCache() : fileEmbeddingCache(path.resolve(values.cache));
  const write = (report: EvalReport) => {
    if (!values.out) return;
    const file = path.resolve(values.out);
    mkdirSync(path.dirname(file), { recursive: true });
    const saved = withoutPassageText(report);
    writeFileSync(file, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...saved }, null, 2)}\n`);
  };

  const corpus = loadCorpus();
  const questions = loadQuestions();
  const unanswerable = values["no-unanswerable"] ? [] : loadUnanswerable();
  console.log(
    `Retrieval eval: ${embedder.modelId}, ${configs.length} configuration(s), modes ${modes.join(", ")}`,
  );
  const report = await runRetrievalEval({
    embedder,
    corpus,
    questions,
    configs,
    modes,
    unanswerable,
    paceMs: Number(values["pace-ms"]),
    ...(rateLimiter ? { rateLimiter } : {}),
    cache,
    ...(budget !== undefined ? { budget } : {}),
    onProgress: write,
    log: (line) => console.log(line),
    // Warnings and failures only; one "document ingested" line per document is noise here.
    logger: createLogger({ level: process.env.EVAL_LOG_LEVEL ?? "warn" }),
  });
  console.log(`\n${formatReport(report)}`);

  write(report);
  if (values.out) console.log(`\nWrote ${values.out}`);
  if (values.review) {
    // The shipped default configuration if it ran, else the first one.
    const config =
      report.configs.find(
        (c) =>
          c.chunk.targetTokens === DEFAULT_CHUNK_OPTIONS.targetTokens &&
          c.chunk.overlapRatio === DEFAULT_CHUNK_OPTIONS.overlapRatio,
      ) ?? report.configs[0]!;
    const file = path.resolve(values.review);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      formatUnanswerableReview(report, config, unanswerable, new Date().toISOString().slice(0, 10)),
    );
    console.log(`Wrote ${values.review}`);
  }
}

main()
  .then(() => getDb().pool.end())
  .catch(async (err: unknown) => {
    // Messages and the provider's reason only: an SDK error also carries the request
    // (texts, headers), which must not be printed.
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
    const provider = evalDiagnostics.lastProviderError;
    for (const line of providerReason(provider ? { cause: provider } : err)) console.error(`  ${line}`);
    await getDb()
      .pool.end()
      .catch(() => {});
    process.exitCode = 1;
  });

/**
 * Follows `cause` links and reports what the provider said: HTTP status, Google's error
 * status and any quota that was exceeded (which limit: per minute, per day, tokens).
 */
function providerReason(err: unknown): string[] {
  const lines: string[] = [];
  const seen = new Set<unknown>();
  let e: unknown = (err as { cause?: unknown } | undefined)?.cause;
  while (e instanceof Error && !seen.has(e) && lines.length < 10) {
    seen.add(e);
    const call = e as Error & { statusCode?: number; responseBody?: string; lastError?: unknown };
    lines.push(
      `caused by ${e.name}: ${e.message.slice(0, 200)}${call.statusCode ? ` (HTTP ${call.statusCode})` : ""}`,
    );
    if (call.responseBody) {
      try {
        const body = JSON.parse(call.responseBody) as {
          error?: {
            status?: string;
            details?: { violations?: { quotaId?: string; quotaValue?: string }[] }[];
          };
        };
        if (body.error?.status) lines.push(`provider status: ${body.error.status}`);
        for (const d of body.error?.details ?? [])
          for (const v of d.violations ?? [])
            lines.push(`quota exceeded: ${v.quotaId} (limit ${v.quotaValue})`);
      } catch {
        // not JSON: the status line above is enough
      }
    }
    e = call.lastError ?? e.cause;
  }
  return lines;
}
