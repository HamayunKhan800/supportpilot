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

/**
 * Merges two ranked lists (each already sorted best first) and returns the best `topK`.
 * Ties are broken by the better single rank, then by chunk id, so results are stable.
 */
export function fuseRankings(
  vectorHits: readonly VectorHit[],
  keywordHits: readonly KeywordHit[],
  { k = RRF_K, topK = RETRIEVAL_TOP_K }: { k?: number; topK?: number } = {},
): FusedHit[] {
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
    hit.rrfScore += 1 / (k + i + 1);
    hit.matchedBy.push("vector");
  });
  keywordHits.forEach((h, i) => {
    const hit = entry(h.chunkId);
    if (hit.keyword) return;
    hit.keyword = { rank: i + 1, score: h.score };
    hit.rrfScore += 1 / (k + i + 1);
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
