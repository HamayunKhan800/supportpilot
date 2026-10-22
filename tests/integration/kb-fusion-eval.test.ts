import { like } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { createMockEmbedder } from "@/server/modules/kb/embedder";
import { getDb } from "@/server/platform/db/client";
import { organization } from "@/server/platform/db/schema";

import { cacheOnlyEmbedder, FUSION_VARIANTS, runFusionEval } from "../../scripts/lib/fusion-eval";
import { loadCorpus, loadQuestions, questionTargets } from "../../scripts/lib/kb-corpus";
import { type EvalReport, memoryEmbeddingCache, runRetrievalEval } from "../../scripts/lib/retrieval-eval";
import { resetDatabase } from "./support/client";

/**
 * The offline fusion experiment (ADR-0014) must use only cached embeddings, and its numbers
 * must match the real search pipeline, or its conclusions wouldn't describe the app.
 * Vector search with the mock embedder is exactly repeatable, so it is compared exactly.
 */
const corpus = loadCorpus().slice(0, 6);
const files = new Set(corpus.map((a) => a.file));
const questions = loadQuestions().filter((q) => questionTargets(q).every((t) => files.has(t.article)));
const chunk = { targetTokens: 500, overlapRatio: 0.15 };
const mock = createMockEmbedder();
const cache = memoryEmbeddingCache();
let baseline: EvalReport;

beforeAll(async () => {
  await resetDatabase();
  // Fills the cache through the normal eval, as the Gemini run filled eval/cache.
  baseline = await runRetrievalEval({ embedder: mock, corpus, questions, configs: [chunk], cache });
}, 120_000);

const workspaces = () =>
  getDb().db.select().from(organization).where(like(organization.slug, "retrieval-eval-%"));

describe("offline fusion eval", () => {
  it("has enough questions in the subset to mean something", () => {
    expect(questions.length).toBeGreaterThanOrEqual(15);
  });

  it("reproduces the real pipeline: the app default and vector only match the eval's numbers", async () => {
    const report = await runFusionEval({
      embedder: cacheOnlyEmbedder(mock.modelId, cache),
      corpus,
      questions,
      chunk,
      watch: [questions[0]!.id],
    });
    const evalMode = (m: string) => baseline.configs[0]!.modes.find((x) => x.mode === m)!;
    const variant = (prefix: string) => report.variants.find((v) => v.name.startsWith(prefix))!;
    expect(report.variants.map((v) => v.name)).toEqual(FUSION_VARIANTS.map((v) => v.name));
    for (const name of ["app default", "vector only"]) {
      expect(variant(name).recallAtK).toBe(evalMode("vector").recallAtK);
      expect(variant(name).mrrAtK).toBe(evalMode("vector").mrrAtK);
      expect(variant(name).betterThanVector).toEqual([]);
      expect(variant(name).worseThanVector).toEqual([]);
    }
    expect(variant("app default").watched[questions[0]!.id]).toBe(
      evalMode("vector").questions.find((q) => q.id === questions[0]!.id)!.firstGoldRank,
    );
    expect(await workspaces()).toEqual([]);
  });

  it("never calls a provider: a missing embedding is an error, and the workspace is still removed", async () => {
    const empty = cacheOnlyEmbedder(mock.modelId, memoryEmbeddingCache());
    await expect(empty.embedQuery("anything")).rejects.toThrow("never calls the provider");
    await expect(runFusionEval({ embedder: empty, corpus, questions, chunk })).rejects.toThrow();
    expect(await workspaces()).toEqual([]);
  });

  it("a different model id finds nothing in the cache (no mixing of embedding models)", async () => {
    const other = cacheOnlyEmbedder("gemini-embedding-2@768", cache);
    await expect(other.embedQuery(questions[0]!.question)).rejects.toThrow(
      "No cached gemini-embedding-2@768",
    );
  });
});
