/**
 * Hybrid retrieval scoring (plan M4 D10). Pure functions, no server imports.
 *
 * Two ranked lists (meaning-based vector search and keyword search) are merged with
 * Reciprocal Rank Fusion: score(d) = Σ 1 / (k + rank(d)), with ranks starting at 1 and
 * k = 60 from the original paper (Cormack, Clarke & Büttcher, SIGIR 2009). RRF uses only
 * ranks, so cosine similarities and keyword scores, which are on different scales, never
 * have to be compared.
 */

export const RRF_K = 60;
/** Candidates taken from each search before fusion. */
export const RETRIEVAL_CANDIDATES = 8;
/** Results returned after fusion. */
export const RETRIEVAL_TOP_K = 5;

/**
 * Default `retrieval_min_score`: drafts are refused without a model call when the best passage
 * scores below it (M5 D7). 0.62 from the M6 threshold analysis (docs/eval/refusal-threshold.md,
 * Gemini embeddings): every answerable test question scored above it, and the only questions
 * below it were off-topic. It is a backstop; the model's INSUFFICIENT_KNOWLEDGE answer does
 * most of the refusing, because near-miss questions score like real ones.
 */
export const DEFAULT_RETRIEVAL_MIN_SCORE = 0.62;

export interface VectorHit {
  chunkId: string;
  /** Cosine similarity, 1 − cosine distance. */
  similarity: number;
}

export interface KeywordHit {
  chunkId: string;
  /** PostgreSQL ts_rank_cd score. */
  score: number;
}

export type MatchSource = "vector" | "keyword";

export interface FusedHit {
  chunkId: string;
  rrfScore: number;
  matchedBy: MatchSource[];
  vector: { rank: number; similarity: number } | null;
  keyword: { rank: number; score: number } | null;
}

export interface FusionOptions {
  k?: number;
  topK?: number;
  /**
   * Weight of each list's RRF contribution (weighted RRF); both default to 1. A weight of 0
   * keeps that list's hits as labels and as fill-ins after every hit from the other list.
   */
  vectorWeight?: number;
  keywordWeight?: number;
}

/**
 * The app's weights (ADR-0014). With real Gemini embeddings, equal-weight fusion ranked worse
 * than meaning search alone on 23 of 110 eval questions and better on 6, so results are ranked
 * by meaning. Keyword search still runs, to label results ("Keywords #n" in test search) and so
 * fusion can be switched back on here if a larger eval shows it helps (e.g. exact error codes).
 * Its hits would only fill slots if vector search returned fewer than topK passages, which in
 * practice it doesn't: every passage has an embedding and both searches see the same documents.
 */
export const RETRIEVAL_FUSION: Readonly<Required<Pick<FusionOptions, "vectorWeight" | "keywordWeight">>> = {
  vectorWeight: 1,
  keywordWeight: 0,
};

/**
 * Merges two ranked lists (each already sorted best first) and returns the best `topK`.
 * Ties are broken by the better single rank, then by chunk id, so results are stable.
 */
export function fuseRankings(
  vectorHits: readonly VectorHit[],
  keywordHits: readonly KeywordHit[],
  { k = RRF_K, topK = RETRIEVAL_TOP_K, vectorWeight = 1, keywordWeight = 1 }: FusionOptions = {},
): FusedHit[] {
  const valid = (w: number) => Number.isFinite(w) && w >= 0;
  if (!valid(vectorWeight) || !valid(keywordWeight) || vectorWeight + keywordWeight === 0) {
    throw new RangeError("Fusion weights must be finite, non-negative and not both zero");
  }
  const byId = new Map<string, FusedHit>();
  const entry = (chunkId: string): FusedHit => {
    let hit = byId.get(chunkId);
    if (!hit) {
      hit = { chunkId, rrfScore: 0, matchedBy: [], vector: null, keyword: null };
      byId.set(chunkId, hit);
    }
    return hit;
  };

  vectorHits.forEach((h, i) => {
    const hit = entry(h.chunkId);
    if (hit.vector) return; // a list should not repeat a chunk; count only its best rank
    hit.vector = { rank: i + 1, similarity: h.similarity };
    hit.rrfScore += vectorWeight / (k + i + 1);
    hit.matchedBy.push("vector");
  });
  keywordHits.forEach((h, i) => {
    const hit = entry(h.chunkId);
    if (hit.keyword) return;
    hit.keyword = { rank: i + 1, score: h.score };
    hit.rrfScore += keywordWeight / (k + i + 1);
    hit.matchedBy.push("keyword");
  });

  const bestRank = (h: FusedHit) => Math.min(h.vector?.rank ?? Infinity, h.keyword?.rank ?? Infinity);
  return [...byId.values()]
    .sort(
      (a, b) =>
        b.rrfScore - a.rrfScore ||
        bestRank(a) - bestRank(b) ||
        (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0),
    )
    .slice(0, topK);
}
