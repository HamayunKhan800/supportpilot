/**
 * Offline comparison of ways to combine vector and keyword search (milestones #71).
 *
 * Runs on embeddings already in the eval cache: the embedder below never calls a provider,
 * so experiments cost nothing and can be repeated. Each question is searched once per list
 * (vector and keyword, `depth` candidates each); every variant is then computed in memory
 * with the app's own fuseRankings, so the numbers describe the code that would ship.
 */
import type { Logger } from "pino";

import type { ChunkOptions } from "../../src/server/modules/kb/chunker";
import type { Embedder } from "../../src/server/modules/kb/embedder";
import * as repo from "../../src/server/modules/kb/repository";
import {
  type FusionOptions,
  fuseRankings,
  type KeywordHit,
  RETRIEVAL_FUSION,
  RETRIEVAL_TOP_K,
  type VectorHit,
} from "../../src/server/modules/kb/retrieval";
import {
  type RankScore,
  scoreRanking,
  summarizeScores,
} from "../../src/server/modules/eval/retrieval-metrics";
import { getDb } from "../../src/server/platform/db/client";
import { transaction } from "../../src/server/platform/db/tx";

import type { CorpusArticle, EvalQuestion } from "./kb-corpus";
import { documentInput, type EmbeddingCache, embeddingKey, setUpEvalWorkspace } from "./retrieval-eval";

/** Serves embeddings from the cache only; a missing one is an error, never an API call. */
export function cacheOnlyEmbedder(modelId: string, cache: EmbeddingCache): Embedder {
  const get = (kind: "document" | "query", input: string) => {
    const hit = cache.get(embeddingKey(modelId, kind, input));
    if (!hit)
      throw new Error(`No cached ${modelId} embedding for a ${kind}; this script never calls the provider`);
    return hit;
  };
  return {
    modelId,
    async embedDocuments(items) {
      const hits = items.map((i) => get("document", documentInput(i)));
      return { embeddings: hits.map((h) => h.embedding), tokenEstimate: 0 };
    },
    async embedQuery(query) {
      return { embedding: get("query", query).embedding, tokenEstimate: 0 };
    },
  };
}

/** One way of turning the two candidate lists into the final top 5. */
export interface FusionVariant {
  name: string;
  /** null: that list isn't used at all. */
  vectorCandidates: number | null;
  keywordCandidates: number | null;
  fusion?: FusionOptions;
}

export const FUSION_VARIANTS: readonly FusionVariant[] = [
  {
    name: "app default: vector-ranked, keyword labels and fill-ins (ADR-0014)",
    vectorCandidates: 8,
    keywordCandidates: 8,
    fusion: RETRIEVAL_FUSION,
  },
  { name: "hybrid RRF 8+8, equal weights (previous default)", vectorCandidates: 8, keywordCandidates: 8 },
  { name: "vector only", vectorCandidates: 8, keywordCandidates: null },
  { name: "keyword only", vectorCandidates: null, keywordCandidates: 8 },
  {
    name: "hybrid RRF 8+8, vector weight 2",
    vectorCandidates: 8,
    keywordCandidates: 8,
    fusion: { vectorWeight: 2 },
  },
  {
    name: "hybrid RRF 8+8, vector weight 3",
    vectorCandidates: 8,
    keywordCandidates: 8,
    fusion: { vectorWeight: 3 },
  },
  { name: "hybrid RRF 8+3 (fewer keyword candidates)", vectorCandidates: 8, keywordCandidates: 3 },
];

export interface CandidateLists {
  vector: VectorHit[];
  keyword: KeywordHit[];
}

/** The final ranked chunk ids for one variant. */
export function rankWith(variant: FusionVariant, lists: CandidateLists, topK = RETRIEVAL_TOP_K): string[] {
  const vector = variant.vectorCandidates === null ? [] : lists.vector.slice(0, variant.vectorCandidates);
  const keyword = variant.keywordCandidates === null ? [] : lists.keyword.slice(0, variant.keywordCandidates);
  return fuseRankings(vector, keyword, { ...variant.fusion, topK }).map((h) => h.chunkId);
}

export interface VariantResult {
  name: string;
  recallAtK: number;
  mrrAtK: number;
  /** Rank of the first gold passage for chosen questions (null = not in the top 5). */
  watched: Record<string, number | null>;
  /** Questions this variant ranks better / worse than vector only. */
  betterThanVector: string[];
  worseThanVector: string[];
}

export interface FusionReport {
  model: string;
  chunk: ChunkOptions;
  questions: number;
  variants: VariantResult[];
}

export async function runFusionEval(options: {
  embedder: Embedder;
  corpus: readonly CorpusArticle[];
  questions: readonly EvalQuestion[];
  chunk: ChunkOptions;
  variants?: readonly FusionVariant[];
  /** Question ids to report individually (e.g. the ones with exact error codes). */
  watch?: readonly string[];
  log?: (line: string) => void;
  logger?: Logger;
}): Promise<FusionReport> {
  const log = options.log ?? (() => {});
  const variants = options.variants ?? FUSION_VARIANTS;
  const depth = Math.max(...variants.flatMap((v) => [v.vectorCandidates ?? 0, v.keywordCandidates ?? 0]));
  const ws = await setUpEvalWorkspace(options.chunk, {
    corpus: options.corpus,
    questions: options.questions,
    embedder: options.embedder,
    log,
    ...(options.logger ? { logger: options.logger } : {}),
  });
  try {
    const { db } = getDb();
    const lists = new Map<string, CandidateLists>();
    for (const q of options.questions) {
      const { embedding } = await options.embedder.embedQuery(q.question);
      const vector = await transaction((tx) => repo.vectorSearch(tx, ws.workspaceId, embedding, depth));
      const keyword = await repo.keywordSearch(db, ws.workspaceId, q.question, depth);
      lists.set(q.id, { vector, keyword });
    }

    const rankFor = (variant: FusionVariant) =>
      new Map(
        options.questions.map((q) => [
          q.id,
          scoreRanking(rankWith(variant, lists.get(q.id)!), ws.gold.get(q.id)!, RETRIEVAL_TOP_K),
        ]),
      );
    const vectorOnly = rankFor({ name: "vector only", vectorCandidates: depth, keywordCandidates: null });
    const rr = (s: RankScore) => s.reciprocalRank;

    const results: VariantResult[] = variants.map((variant) => {
      const scores = rankFor(variant);
      const summary = summarizeScores([...scores.values()]);
      const better: string[] = [];
      const worse: string[] = [];
      for (const [id, s] of scores) {
        const base = vectorOnly.get(id)!;
        if (rr(s) > rr(base)) better.push(id);
        if (rr(s) < rr(base)) worse.push(id);
      }
      return {
        name: variant.name,
        recallAtK: summary.recallAtK,
        mrrAtK: summary.mrrAtK,
        watched: Object.fromEntries(
          (options.watch ?? []).map((id) => [id, scores.get(id)?.firstGoldRank ?? null]),
        ),
        betterThanVector: better,
        worseThanVector: worse,
      };
    });
    return {
      model: options.embedder.modelId,
      chunk: options.chunk,
      questions: options.questions.length,
      variants: results,
    };
  } finally {
    await ws.remove();
  }
}
