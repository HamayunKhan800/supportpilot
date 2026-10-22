/**
 * Retrieval eval harness (plan M4 step 6). For each chunking configuration it:
 *   1. creates a throwaway workspace,
 *   2. ingests the corpus with the production job (runIngestJob: PDF extraction, chunking,
 *      embedding, saving), exactly as the worker does,
 *   3. asks every question in each mode: "hybrid" is the production hybridSearch (vector 8 +
 *      keyword 8, RRF, top 5); "vector" and "keyword" are each half alone (top 5),
 *   4. scores the top 5 against the evidence labels, and
 *   5. deletes the workspace (cascades to documents, chunks and usage rows), even on failure.
 *
 * Query embeddings are cached, so each question is embedded once per run whatever the
 * number of configurations and modes; embedding latency is measured on those real calls only.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import type { Logger } from "pino";

import {
  type EvalChunk,
  goldChunks,
  percentile,
  type RankScore,
  scoreRanking,
  summarizeScores,
} from "../../src/server/modules/eval/retrieval-metrics";
import type { ChunkOptions } from "../../src/server/modules/kb/chunker";
import { embeddingCostMicros, type Embedder } from "../../src/server/modules/kb/embedder";
import { chunkTitle, runIngestJob } from "../../src/server/modules/kb/ingest-job";
import { prepareDocument } from "../../src/server/modules/kb/prepare";
import * as repo from "../../src/server/modules/kb/repository";
import { RETRIEVAL_TOP_K } from "../../src/server/modules/kb/retrieval";
import { hybridSearch } from "../../src/server/modules/kb/service";
import { getDb } from "../../src/server/platform/db/client";
import { kbChunk, organization } from "../../src/server/platform/db/schema";
import { transaction } from "../../src/server/platform/db/tx";
import { chunked, estimateTokens, type TextRateLimiter } from "./rate-limit";

import {
  type CorpusArticle,
  type EvalQuestion,
  questionTargets,
  type UnanswerableQuestion,
} from "./kb-corpus";

export const EVAL_MODES = ["hybrid", "vector", "keyword"] as const;
export type EvalMode = (typeof EVAL_MODES)[number];

export interface EvalOptions {
  embedder: Embedder;
  corpus: CorpusArticle[];
  questions: EvalQuestion[];
  configs: ChunkOptions[];
  modes?: readonly EvalMode[];
  /**
   * Questions the corpus does not answer. The eval saves what search finds for them (for the
   * human check that they really are unanswerable) and compares their best vector match
   * with the answerable questions' (a first look at refusing by score, calibrated in M6).
   */
  unanswerable?: readonly UnanswerableQuestion[];
  /** Wait this long before each real embedding call (free-tier rate limits). */
  paceMs?: number;
  /**
   * At most this many embedded texts per rolling minute, across all calls (Gemini counts
   * each text in a batch). Larger document batches are split to fit.
   */
  rateLimiter?: TextRateLimiter;
  /** Reuse embeddings across configurations and runs (see fileEmbeddingCache). */
  cache?: EmbeddingCache;
  /**
   * Refuse to start if the run needs more new embeddings than this. The Gemini free tier
   * allows 1,000 embedded texts per day per project and counts each passage in a batch.
   */
  budget?: number;
  /** Called with the report so far after each configuration, so a failure loses nothing. */
  onProgress?: (report: EvalReport) => void;
  log?: (line: string) => void;
  /** For the ingest job's own logs (default: the app logger). */
  logger?: Logger;
}

export interface QuestionResult {
  id: string;
  firstGoldRank: number | null;
  /** Articles of the top 5, for error analysis. */
  retrieved: string[];
}

export interface ModeResult {
  mode: EvalMode;
  recallAtK: number;
  mrrAtK: number;
  retrievalMs: { p50: number; p95: number };
  questions: QuestionResult[];
}

export interface ConfigResult {
  chunk: ChunkOptions;
  chunkCount: number;
  /** Questions whose evidence was cut in two by chunking (see goldChunks). */
  splitEvidence: string[];
  documentEmbedMs: { p50: number; p95: number };
  documentTokens: number;
  modes: ModeResult[];
  unanswerable?: UnanswerableResult;
}

export interface FoundPassage {
  article: string;
  headingPath: string;
  /** Cosine similarity for vector hits; absent for keyword hits. */
  similarity?: number;
  content: string;
}

export interface UnanswerableResult {
  /** Best vector similarity per question: can a score threshold tell the two groups apart? */
  answerableTop1: ScoreSpread;
  unanswerableTop1: ScoreSpread;
  questions: { id: string; vector: FoundPassage[]; keyword: FoundPassage[] }[];
}

export interface ScoreSpread {
  min: number;
  p50: number;
  max: number;
}

export interface EvalReport {
  model: string;
  k: number;
  questionCount: number;
  documentCount: number;
  configs: ConfigResult[];
  queryEmbedMs: { p50: number; p95: number; calls: number };
  queryTokens: number;
  totalTokens: number;
  /** Embedded texts sent to the provider in this run (cache misses), and cache hits. */
  embeddedTexts: number;
  cacheHits: number;
  /** False while configurations are still running (partial report). */
  complete: boolean;
  /** At the paid-tier list price; the free tier costs $0. */
  estCostMicros: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round = (n: number) => Math.round(n * 10) / 10;
const spread = (values: number[]): ScoreSpread => ({
  min: round3(Math.min(...values)),
  p50: round3(percentile(values, 50)),
  max: round3(Math.max(...values)),
});
const round3 = (n: number) => Math.round(n * 1000) / 1000;

const stats = (values: number[]) => ({
  p50: round(percentile(values, 50)),
  p95: round(percentile(values, 95)),
});

// --- Embedding cache ----------------------------------------------------------------------

export interface CachedEmbedding {
  embedding: number[];
  tokenEstimate: number;
}

export interface EmbeddingCache {
  get(key: string): CachedEmbedding | undefined;
  set(key: string, value: CachedEmbedding): void;
}

/** Key for one text: model (with dimensions), kind and the exact input. */
export function embeddingKey(modelId: string, kind: "document" | "query", input: string): string {
  return createHash("sha256").update(`${modelId}\0${kind}\0${input}`).digest("hex");
}

const documentInput = (item: { title: string; text: string }) => JSON.stringify([item.title, item.text]);

export function memoryEmbeddingCache(): EmbeddingCache {
  const map = new Map<string, CachedEmbedding>();
  return { get: (k) => map.get(k), set: (k, v) => void map.set(k, v) };
}

/**
 * Embeddings stored as JSON lines in `dir/embeddings.jsonl` (git-ignored). Vectors only, no
 * text: keys are hashes. Lets a later run (other chunking, other fusion settings) reuse every
 * embedding already paid for in free-tier quota.
 */
export function fileEmbeddingCache(dir: string): EmbeddingCache {
  const file = path.join(dir, "embeddings.jsonl");
  const map = new Map<string, CachedEmbedding>();
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      const { k, v, t } = JSON.parse(line) as { k: string; v: number[]; t: number };
      map.set(k, { embedding: v, tokenEstimate: t });
    }
  } else {
    mkdirSync(dir, { recursive: true });
  }
  return {
    get: (k) => map.get(k),
    set(k, value) {
      map.set(k, value);
      appendFileSync(file, `${JSON.stringify({ k, v: value.embedding, t: value.tokenEstimate })}\n`);
    },
  };
}

/**
 * Wraps the embedder: serves cached texts, sends only the missing ones (one batch per call,
 * as ingestion does), and times and counts real calls only.
 */
/**
 * The last error the embedding provider returned during this run. The app's search turns
 * provider errors into user-facing messages without the details (they include the request),
 * so the eval script reads the original here to report which limit was hit.
 */
export const evalDiagnostics: { lastProviderError: unknown } = { lastProviderError: undefined };

/** Remembers a provider error for the report, then passes it on unchanged. */
async function remember<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    evalDiagnostics.lastProviderError = err;
    throw err;
  }
}

function instrument(inner: Embedder, paceMs: number, cache: EmbeddingCache, limiter?: TextRateLimiter) {
  const m = {
    documentMs: [] as number[],
    documentTokens: 0,
    queryMs: [] as number[],
    queryTokens: 0,
    embeddedTexts: 0,
    cacheHits: 0,
  };
  const inflight = new Map<string, Promise<CachedEmbedding>>();
  const embedder: Embedder = {
    modelId: inner.modelId,
    async embedDocuments(items, signal) {
      const keys = items.map((i) => embeddingKey(inner.modelId, "document", documentInput(i)));
      const missing = [...new Set(keys.filter((k) => !cache.get(k)))];
      m.cacheHits += keys.length - missing.length;
      let spent = 0;
      if (missing.length > 0) {
        const parts = chunked(missing, limiter?.maxBatch ?? missing.length);
        for (const partKeys of parts) {
          const toEmbed = partKeys.map((k) => items[keys.indexOf(k)]!);
          if (paceMs) await sleep(paceMs);
          await limiter?.acquire(
            toEmbed.length,
            toEmbed.reduce((n, i) => n + estimateTokens(documentInput(i)), 0),
          );
          const start = performance.now();
          const batch = await remember(inner.embedDocuments(toEmbed, signal));
          m.documentMs.push(performance.now() - start);
          m.documentTokens += batch.tokenEstimate;
          m.embeddedTexts += toEmbed.length;
          spent += batch.tokenEstimate;
          const totalChars = toEmbed.reduce((n, i) => n + i.title.length + i.text.length, 0) || 1;
          partKeys.forEach((k, i) => {
            const chars = toEmbed[i]!.title.length + toEmbed[i]!.text.length;
            cache.set(k, {
              embedding: batch.embeddings[i]!,
              tokenEstimate: Math.round((batch.tokenEstimate * chars) / totalChars),
            });
          });
        }
      }
      // Only tokens actually sent count as spent (ingestion records them in ai_usage).
      return { embeddings: keys.map((k) => cache.get(k)!.embedding), tokenEstimate: spent };
    },
    async embedQuery(query, signal) {
      const key = embeddingKey(inner.modelId, "query", query);
      const hit = cache.get(key);
      if (hit) {
        m.cacheHits++;
        return hit;
      }
      let pending = inflight.get(key);
      if (!pending) {
        pending = (async () => {
          if (paceMs) await sleep(paceMs);
          await limiter?.acquire(1, estimateTokens(query));
          const start = performance.now();
          const result = await remember(inner.embedQuery(query, signal));
          m.queryMs.push(performance.now() - start);
          m.queryTokens += result.tokenEstimate;
          m.embeddedTexts++;
          cache.set(key, result);
          return result;
        })().finally(() => inflight.delete(key));
        inflight.set(key, pending);
      }
      return pending;
    },
  };
  return { embedder, metrics: m };
}

/** New embeddings a run would need, worked out locally (chunking only, no API calls). */
export async function countNewEmbeddings(
  modelId: string,
  corpus: readonly CorpusArticle[],
  queries: readonly string[],
  configs: readonly ChunkOptions[],
  cache: EmbeddingCache,
): Promise<number> {
  const keys = new Set<string>();
  for (const chunk of configs) {
    for (const article of corpus) {
      const prepared = await prepareDocument(article.mimeType, article.bytes, { chunk });
      for (const c of prepared.chunks) {
        const input = documentInput({ title: chunkTitle(article.title, c.headingPath), text: c.content });
        keys.add(embeddingKey(modelId, "document", input));
      }
    }
  }
  for (const q of queries) keys.add(embeddingKey(modelId, "query", q));
  return [...keys].filter((k) => !cache.get(k)).length;
}

async function rank(
  mode: EvalMode,
  workspaceId: string,
  question: string,
  embedder: Embedder,
): Promise<{ ids: string[]; ms: number }> {
  if (mode === "hybrid") {
    const res = await hybridSearch(workspaceId, question, embedder);
    return { ids: res.results.map((r) => r.chunk.id), ms: res.timingsMs.retrieval };
  }
  if (mode === "vector") {
    const { embedding } = await embedder.embedQuery(question);
    const start = performance.now();
    const hits = await transaction((tx) => repo.vectorSearch(tx, workspaceId, embedding, RETRIEVAL_TOP_K));
    return { ids: hits.map((h) => h.chunkId), ms: performance.now() - start };
  }
  const start = performance.now();
  const hits = await repo.keywordSearch(getDb().db, workspaceId, question, RETRIEVAL_TOP_K);
  return { ids: hits.map((h) => h.chunkId), ms: performance.now() - start };
}

async function runConfig(
  chunk: ChunkOptions,
  opts: Required<Pick<EvalOptions, "corpus" | "questions" | "modes">> & {
    unanswerable?: readonly UnanswerableQuestion[];
    embedder: Embedder;
    log: (line: string) => void;
    logger?: Logger;
    metrics: ReturnType<typeof instrument>["metrics"];
  },
): Promise<ConfigResult> {
  const { db } = getDb();
  const workspaceId = randomUUID();
  const docStart = opts.metrics.documentMs.length;
  const tokensStart = opts.metrics.documentTokens;
  await db.insert(organization).values({
    id: workspaceId,
    name: "Retrieval eval (temporary)",
    slug: `retrieval-eval-${workspaceId}`,
    createdAt: new Date(),
  });
  try {
    const articleByDocument = new Map<string, string>();
    for (const article of opts.corpus) {
      const doc = await transaction((tx) =>
        repo.insertDocument(tx, workspaceId, {
          title: article.title,
          filename: article.filename,
          mimeType: article.mimeType,
          sha256: article.sha256,
          uploadedBy: null,
          bytes: article.bytes,
        }),
      );
      articleByDocument.set(doc.id, article.file);
      const outcome = await runIngestJob(
        { workspaceId, documentId: doc.id },
        { isFinalAttempt: true },
        { embedder: opts.embedder, prepare: { chunk }, ...(opts.logger ? { logger: opts.logger } : {}) },
      );
      if (outcome.status !== "ready") {
        throw new Error(`Ingesting ${article.file} did not finish: ${JSON.stringify(outcome)}`);
      }
    }

    const rows = await db
      .select({
        id: kbChunk.id,
        documentId: kbChunk.documentId,
        headingPath: kbChunk.headingPath,
        content: kbChunk.content,
      })
      .from(kbChunk)
      .where(eq(kbChunk.workspaceId, workspaceId));
    const chunks: EvalChunk[] = rows.map((r) => ({
      id: r.id,
      article: articleByDocument.get(r.documentId)!,
      content: r.content,
    }));
    opts.log(
      `  chunks ${chunk.targetTokens}/${chunk.overlapRatio}: ${opts.corpus.length} documents, ${chunks.length} chunks`,
    );

    const splitEvidence: string[] = [];
    const gold = new Map<string, Set<string>>();
    for (const q of opts.questions) {
      const g = goldChunks(chunks, questionTargets(q));
      if (g.missing.length > 0) {
        throw new Error(`Question ${q.id}: evidence not found in its article: ${JSON.stringify(g.missing)}`);
      }
      if (g.split) splitEvidence.push(q.id);
      gold.set(q.id, g.ids);
    }

    const article = new Map(chunks.map((c) => [c.id, c.article]));
    const modes: ModeResult[] = [];
    for (const mode of opts.modes) {
      const scores: RankScore[] = [];
      const ms: number[] = [];
      const questions: QuestionResult[] = [];
      for (const q of opts.questions) {
        const ranked = await rank(mode, workspaceId, q.question, opts.embedder);
        ms.push(ranked.ms);
        const score = scoreRanking(ranked.ids, gold.get(q.id)!, RETRIEVAL_TOP_K);
        scores.push(score);
        questions.push({
          id: q.id,
          firstGoldRank: score.firstGoldRank,
          retrieved: ranked.ids.slice(0, RETRIEVAL_TOP_K).map((id) => article.get(id) ?? "?"),
        });
      }
      const summary = summarizeScores(scores);
      modes.push({
        mode,
        recallAtK: summary.recallAtK,
        mrrAtK: summary.mrrAtK,
        retrievalMs: stats(ms),
        questions,
      });
      opts.log(
        `    ${mode.padEnd(7)} recall@5 ${(summary.recallAtK * 100).toFixed(1)}%  MRR@5 ${summary.mrrAtK.toFixed(3)}`,
      );
    }
    let unanswerable: UnanswerableResult | undefined;
    if (opts.unanswerable?.length) {
      const byId = new Map(rows.map((r) => [r.id, r]));
      const passage = (id: string, similarity?: number): FoundPassage => {
        const row = byId.get(id)!;
        return {
          article: article.get(id) ?? "?",
          headingPath: row.headingPath,
          ...(similarity === undefined ? {} : { similarity: round3(similarity) }),
          content: row.content,
        };
      };
      const vectorHits = async (question: string) => {
        const { embedding } = await opts.embedder.embedQuery(question);
        return transaction((tx) => repo.vectorSearch(tx, workspaceId, embedding, RETRIEVAL_TOP_K));
      };
      const answerableTop1: number[] = [];
      for (const q of opts.questions) answerableTop1.push((await vectorHits(q.question))[0]?.similarity ?? 0);
      const unanswerableTop1: number[] = [];
      const found: UnanswerableResult["questions"] = [];
      for (const q of opts.unanswerable) {
        const vector = await vectorHits(q.question);
        const keyword = await repo.keywordSearch(db, workspaceId, q.question, RETRIEVAL_TOP_K);
        unanswerableTop1.push(vector[0]?.similarity ?? 0);
        found.push({
          id: q.id,
          vector: vector.map((h) => passage(h.chunkId, h.similarity)),
          keyword: keyword.map((h) => passage(h.chunkId)),
        });
      }
      unanswerable = {
        answerableTop1: spread(answerableTop1),
        unanswerableTop1: spread(unanswerableTop1),
        questions: found,
      };
      opts.log(
        `    best vector match: answerable ${unanswerable.answerableTop1.min}–${unanswerable.answerableTop1.max} ` +
          `(median ${unanswerable.answerableTop1.p50}), unanswerable ${unanswerable.unanswerableTop1.min}–` +
          `${unanswerable.unanswerableTop1.max} (median ${unanswerable.unanswerableTop1.p50})`,
      );
    }
    return {
      chunk,
      chunkCount: chunks.length,
      ...(unanswerable ? { unanswerable } : {}),
      splitEvidence,
      documentEmbedMs: stats(opts.metrics.documentMs.slice(docStart)),
      documentTokens: opts.metrics.documentTokens - tokensStart,
      modes,
    };
  } finally {
    await db.delete(organization).where(eq(organization.id, workspaceId));
  }
}

export async function runRetrievalEval(options: EvalOptions): Promise<EvalReport> {
  const cache = options.cache ?? memoryEmbeddingCache();
  const log = options.log ?? (() => {});
  if (options.budget !== undefined) {
    const needed = await countNewEmbeddings(
      options.embedder.modelId,
      options.corpus,
      [...options.questions.map((q) => q.question), ...(options.unanswerable ?? []).map((q) => q.question)],
      options.configs,
      cache,
    );
    log(`New embeddings needed: ${needed} (budget ${options.budget})`);
    if (needed > options.budget) {
      throw new Error(`This run needs ${needed} new embeddings, more than the budget of ${options.budget}`);
    }
  }
  const { embedder, metrics } = instrument(options.embedder, options.paceMs ?? 0, cache, options.rateLimiter);
  const configs: ConfigResult[] = [];
  const report = (complete: boolean): EvalReport => {
    const totalTokens = metrics.documentTokens + metrics.queryTokens;
    return {
      model: embedder.modelId,
      k: RETRIEVAL_TOP_K,
      questionCount: options.questions.length,
      documentCount: options.corpus.length,
      configs: [...configs],
      queryEmbedMs: { ...stats(metrics.queryMs), calls: metrics.queryMs.length },
      queryTokens: metrics.queryTokens,
      totalTokens,
      estCostMicros: embeddingCostMicros(embedder.modelId, totalTokens),
      embeddedTexts: metrics.embeddedTexts,
      cacheHits: metrics.cacheHits,
      complete,
    };
  };
  for (const chunk of options.configs) {
    configs.push(
      await runConfig(chunk, {
        corpus: options.corpus,
        questions: options.questions,
        modes: options.modes ?? EVAL_MODES,
        ...(options.unanswerable ? { unanswerable: options.unanswerable } : {}),
        embedder,
        log,
        ...(options.logger ? { logger: options.logger } : {}),
        metrics,
      }),
    );
    options.onProgress?.(report(false));
  }
  return report(true);
}
