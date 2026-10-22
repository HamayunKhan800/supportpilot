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
import { randomUUID } from "node:crypto";

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
import { runIngestJob } from "../../src/server/modules/kb/ingest-job";
import * as repo from "../../src/server/modules/kb/repository";
import { RETRIEVAL_TOP_K } from "../../src/server/modules/kb/retrieval";
import { hybridSearch } from "../../src/server/modules/kb/service";
import { getDb } from "../../src/server/platform/db/client";
import { kbChunk, organization } from "../../src/server/platform/db/schema";
import { transaction } from "../../src/server/platform/db/tx";

import { type CorpusArticle, type EvalQuestion, questionTargets } from "./kb-corpus";

export const EVAL_MODES = ["hybrid", "vector", "keyword"] as const;
export type EvalMode = (typeof EVAL_MODES)[number];

export interface EvalOptions {
  embedder: Embedder;
  corpus: CorpusArticle[];
  questions: EvalQuestion[];
  configs: ChunkOptions[];
  modes?: readonly EvalMode[];
  /** Wait this long before each real embedding call (free-tier rate limits). */
  paceMs?: number;
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
  /** At the paid-tier list price; the free tier costs $0. */
  estCostMicros: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round = (n: number) => Math.round(n * 10) / 10;
const stats = (values: number[]) => ({
  p50: round(percentile(values, 50)),
  p95: round(percentile(values, 95)),
});

/** Wraps the embedder: caches query vectors, times and counts only real calls. */
function instrument(inner: Embedder, paceMs: number) {
  const queryCache = new Map<string, Promise<{ embedding: number[]; tokenEstimate: number }>>();
  const m = { documentMs: [] as number[], documentTokens: 0, queryMs: [] as number[], queryTokens: 0 };
  const embedder: Embedder = {
    modelId: inner.modelId,
    async embedDocuments(items, signal) {
      if (paceMs) await sleep(paceMs);
      const start = performance.now();
      const batch = await inner.embedDocuments(items, signal);
      m.documentMs.push(performance.now() - start);
      m.documentTokens += batch.tokenEstimate;
      return batch;
    },
    embedQuery(query, signal) {
      let cached = queryCache.get(query);
      if (!cached) {
        cached = (async () => {
          if (paceMs) await sleep(paceMs);
          const start = performance.now();
          const result = await inner.embedQuery(query, signal);
          m.queryMs.push(performance.now() - start);
          m.queryTokens += result.tokenEstimate;
          return result;
        })();
        // A failed call must not poison the cache.
        cached.catch(() => queryCache.delete(query));
        queryCache.set(query, cached);
      }
      return cached;
    },
  };
  return { embedder, metrics: m };
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
      .select({ id: kbChunk.id, documentId: kbChunk.documentId, content: kbChunk.content })
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
    return {
      chunk,
      chunkCount: chunks.length,
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
  const { embedder, metrics } = instrument(options.embedder, options.paceMs ?? 0);
  const log = options.log ?? (() => {});
  const configs: ConfigResult[] = [];
  for (const chunk of options.configs) {
    configs.push(
      await runConfig(chunk, {
        corpus: options.corpus,
        questions: options.questions,
        modes: options.modes ?? EVAL_MODES,
        embedder,
        log,
        ...(options.logger ? { logger: options.logger } : {}),
        metrics,
      }),
    );
  }
  const totalTokens = metrics.documentTokens + metrics.queryTokens;
  return {
    model: embedder.modelId,
    k: RETRIEVAL_TOP_K,
    questionCount: options.questions.length,
    documentCount: options.corpus.length,
    configs,
    queryEmbedMs: { ...stats(metrics.queryMs), calls: metrics.queryMs.length },
    queryTokens: metrics.queryTokens,
    totalTokens,
    estCostMicros: embeddingCostMicros(embedder.modelId, totalTokens),
  };
}
