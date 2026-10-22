import { describe, expect, it } from "vitest";

import { KbSearchResults } from "@/server/api/schemas";
import { fuseRankings, RETRIEVAL_FUSION, RETRIEVAL_TOP_K, RRF_K } from "@/server/modules/kb/retrieval";

const v = (...ids: string[]) => ids.map((chunkId, i) => ({ chunkId, similarity: 0.9 - i * 0.1 }));
const k = (...ids: string[]) => ids.map((chunkId, i) => ({ chunkId, score: 1 - i * 0.1 }));

describe("Reciprocal Rank Fusion (plan D10, Cormack et al. 2009)", () => {
  it("uses k = 60 and returns the top 5", () => {
    expect(RRF_K).toBe(60);
    expect(RETRIEVAL_TOP_K).toBe(5);
  });

  it("scores Σ 1/(k + rank) with ranks from 1", () => {
    const [top] = fuseRankings(v("a"), k("a"));
    expect(top!.rrfScore).toBeCloseTo(1 / 61 + 1 / 61, 12);
    const [single] = fuseRankings(v("x", "y"), []).slice(1);
    expect(single!.rrfScore).toBeCloseTo(1 / 62, 12);
  });

  it("a passage found by both searches beats ones found by only one", () => {
    // b: 1/62 + 1/61 > a: 1/61 > c: 1/62
    const fused = fuseRankings(v("a", "b"), k("b", "c"));
    expect(fused.map((h) => h.chunkId)).toEqual(["b", "a", "c"]);
    expect(fused[0]).toMatchObject({
      matchedBy: ["vector", "keyword"],
      vector: { rank: 2, similarity: 0.8 },
      keyword: { rank: 1, score: 1 },
    });
    expect(fused[1]).toMatchObject({ matchedBy: ["vector"], keyword: null });
    expect(fused[2]).toMatchObject({ matchedBy: ["keyword"], vector: null });
  });

  it("uses only ranks, so very different score scales don't matter", () => {
    const vector = [{ chunkId: "a", similarity: 0.0001 }];
    const keyword = [{ chunkId: "b", score: 9999 }];
    const fused = fuseRankings(vector, keyword);
    expect(fused[0]!.rrfScore).toBe(fused[1]!.rrfScore);
  });

  it("breaks equal scores by the better single rank, then by id (stable results)", () => {
    // x and y both have 1/61 + 1/62; z and w both 1/63.
    const fused = fuseRankings(v("y", "x", "z"), k("x", "y", "w"));
    expect(fused.map((h) => h.chunkId)).toEqual(["x", "y", "w", "z"]);
  });

  it("keeps the best `topK`", () => {
    const fused = fuseRankings(v("a", "b", "c", "d", "e", "f", "g", "h"), k("i", "j", "k"), { topK: 3 });
    expect(fused.map((h) => h.chunkId)).toEqual(["a", "i", "b"]);
    expect(fuseRankings(v("a", "b", "c", "d", "e", "f"), [])).toHaveLength(5);
  });

  it("counts a passage repeated within one list only once, at its best rank", () => {
    const [hit] = fuseRankings(v("a", "a"), []);
    expect(hit!.rrfScore).toBeCloseTo(1 / 61, 12);
    expect(hit!.matchedBy).toEqual(["vector"]);
  });

  it("respects a custom k and handles empty input", () => {
    expect(fuseRankings(v("a"), [], { k: 0 })[0]!.rrfScore).toBe(1);
    expect(fuseRankings([], [])).toEqual([]);
  });
});

describe("weighted fusion (ADR-0014)", () => {
  const ids = (hits: { chunkId: string }[]) => hits.map((h) => h.chunkId);

  it("defaults to equal weights, so existing callers are unchanged", () => {
    const vec = v("a", "b", "c");
    const kw = k("c", "d", "a");
    expect(fuseRankings(vec, kw)).toEqual(fuseRankings(vec, kw, { vectorWeight: 1, keywordWeight: 1 }));
  });

  it("multiplies each list's contribution by its weight", () => {
    const [hit] = fuseRankings(v("a"), k("a"), { vectorWeight: 2, keywordWeight: 0.5 });
    expect(hit!.rrfScore).toBeCloseTo(2 / (RRF_K + 1) + 0.5 / (RRF_K + 1), 12);
  });

  it("a heavier vector weight lets a vector-only hit beat a keyword-only hit at the same rank", () => {
    expect(ids(fuseRankings(v("a"), k("b")))).toEqual(["a", "b"]); // equal: tie broken by id
    expect(ids(fuseRankings(v("b"), k("a"), { vectorWeight: 2 }))).toEqual(["b", "a"]);
  });

  it("keyword weight 0 keeps the vector order exactly, whatever the keyword list says", () => {
    const vec = v("e", "d", "c", "b", "a", "f", "g", "h");
    const kw = k("a", "b", "x", "c");
    expect(ids(fuseRankings(vec, kw, { keywordWeight: 0, topK: 8 }))).toEqual(ids(vec));
  });

  it("keyword weight 0 still labels keyword matches", () => {
    const [first] = fuseRankings(v("a"), k("a"), { keywordWeight: 0 });
    expect(first!.matchedBy).toEqual(["vector", "keyword"]);
    expect(first!.keyword).toEqual({ rank: 1, score: 1 });
  });

  it("keyword weight 0 fills empty slots with keyword-only hits, in keyword order", () => {
    const fused = fuseRankings(v("a", "b"), k("z", "a", "y"), { keywordWeight: 0 });
    expect(ids(fused)).toEqual(["a", "b", "z", "y"]);
    expect(fused[2]!.rrfScore).toBe(0);
  });

  it("rejects negative, non-finite or all-zero weights", () => {
    for (const bad of [
      { vectorWeight: -1 },
      { keywordWeight: Number.NaN },
      { vectorWeight: Infinity },
      { vectorWeight: 0, keywordWeight: 0 },
    ]) {
      expect(() => fuseRankings(v("a"), k("a"), bad)).toThrow(RangeError);
    }
  });

  it("the search API accepts the 0 score a keyword-only fill-in gets (and still rejects negatives)", () => {
    const rrfScore = KbSearchResults.shape.results.element.shape.rrfScore;
    expect(rrfScore.safeParse(0).success).toBe(true);
    expect(rrfScore.safeParse(-0.01).success).toBe(false);
  });

  it("the app ranks by meaning, with keywords as labels and fill-ins", () => {
    expect(RETRIEVAL_FUSION).toEqual({ vectorWeight: 1, keywordWeight: 0 });
  });
});
