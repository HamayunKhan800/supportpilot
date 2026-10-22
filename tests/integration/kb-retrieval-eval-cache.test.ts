import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createMockEmbedder, type Embedder } from "@/server/modules/kb/embedder";
import { getDb } from "@/server/platform/db/client";
import { organization } from "@/server/platform/db/schema";

import { loadCorpus, loadQuestions, loadUnanswerable, questionTargets } from "../../scripts/lib/kb-corpus";
import {
  countNewEmbeddings,
  type EvalReport,
  fileEmbeddingCache,
  runRetrievalEval,
} from "../../scripts/lib/retrieval-eval";
import { createTextRateLimiter } from "../../scripts/lib/rate-limit";
import { resetDatabase } from "./support/client";

/**
 * The eval's embedding cache and budget exist because the Gemini free tier allows 1,000
 * embedded texts per day and an uncached grid run needed about 1,030 (milestones #70, #72).
 * Small corpus subset to stay fast.
 */
const corpus = loadCorpus().slice(0, 3);
const files = new Set(corpus.map((a) => a.file));
const questions = loadQuestions().filter((q) => questionTargets(q).every((t) => files.has(t.article)));
const queries = questions.map((q) => q.question);
const configs = [
  { targetTokens: 300, overlapRatio: 0 },
  { targetTokens: 500, overlapRatio: 0.15 },
];

/** The mock embedder, counting every text that reaches it. */
function countingEmbedder() {
  const inner = createMockEmbedder();
  const sent = { texts: 0, calls: 0 };
  const embedder: Embedder = {
    modelId: inner.modelId,
    embedDocuments(items, signal) {
      sent.calls++;
      sent.texts += items.length;
      return inner.embedDocuments(items, signal);
    },
    embedQuery(query, signal) {
      sent.calls++;
      sent.texts++;
      return inner.embedQuery(query, signal);
    },
  };
  return { embedder, sent };
}

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "eval-cache-"));
  dirs.push(dir);
  return dir;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
beforeEach(() => resetDatabase());

// Vector search with the mock is exactly repeatable; keyword ties are broken by random chunk ids.
const vectorScores = (r: EvalReport) =>
  r.configs.map((c) => c.modes.filter((m) => m.mode === "vector").map((m) => [m.recallAtK, m.mrrAtK]));

describe("retrieval eval embedding cache and budget", () => {
  it("embeds each text once, predicts the count exactly, and a second run sends nothing", async () => {
    expect(questions.length).toBeGreaterThan(3);
    const dir = tempDir();
    const first = countingEmbedder();
    const predicted = await countNewEmbeddings(
      first.embedder.modelId,
      corpus,
      queries,
      configs,
      fileEmbeddingCache(dir),
    );
    const progress: EvalReport[] = [];
    const run1 = await runRetrievalEval({
      embedder: first.embedder,
      corpus,
      questions,
      configs,
      cache: fileEmbeddingCache(dir),
      budget: predicted,
      onProgress: (r) => progress.push(r),
    });
    expect(first.sent.texts).toBe(predicted);
    expect(run1.embeddedTexts).toBe(predicted);
    expect(run1.complete).toBe(true);
    expect(progress.map((r) => [r.configs.length, r.complete])).toEqual([
      [1, false],
      [2, false],
    ]);

    // A fresh process: the cache is read back from disk.
    const second = countingEmbedder();
    const run2 = await runRetrievalEval({
      embedder: second.embedder,
      corpus,
      questions,
      configs,
      cache: fileEmbeddingCache(dir),
      budget: 0,
    });
    expect(second.sent).toEqual({ texts: 0, calls: 0 });
    expect(run2.embeddedTexts).toBe(0);
    expect(run2.totalTokens).toBe(0);
    expect(run2.queryEmbedMs.calls).toBe(0);
    expect(run2.cacheHits).toBeGreaterThan(0);
    expect(vectorScores(run2)).toEqual(vectorScores(run1)); // cached vectors rank like fresh ones
  }, 60_000);

  it("refuses to start, before any call or database write, when the run would exceed the budget", async () => {
    const { embedder, sent } = countingEmbedder();
    await expect(
      runRetrievalEval({
        embedder,
        corpus,
        questions,
        configs,
        cache: fileEmbeddingCache(tempDir()),
        budget: 1,
      }),
    ).rejects.toThrow(/more than the budget of 1/);
    expect(sent.calls).toBe(0);
    const { db } = getDb();
    expect(await db.select().from(organization).where(like(organization.slug, "retrieval-eval-%"))).toEqual(
      [],
    );
  });

  it("counts the unanswerable questions in the budget", async () => {
    const unanswerable = loadUnanswerable().slice(0, 2);
    const cache = fileEmbeddingCache(tempDir());
    const answerableOnly = await countNewEmbeddings("mock-hash@768", corpus, queries, configs, cache);
    const { embedder, sent } = countingEmbedder();
    await expect(
      runRetrievalEval({ embedder, corpus, questions, configs, unanswerable, cache, budget: answerableOnly }),
    ).rejects.toThrow(`needs ${answerableOnly + 2} new embeddings`);
    expect(sent.calls).toBe(0);
  });

  it("never sends more texts per minute than the limit, splitting batches to fit (finding #85)", async () => {
    // A fake clock: the limiter's waits move time forward instead of really waiting.
    const clock = { t: 0 };
    const rateLimiter = createTextRateLimiter({
      // 3, because this subset's largest document batch is 4: splitting must happen.
      maxPerMinute: 3,
      now: () => clock.t,
      sleep: async (ms) => {
        clock.t += ms;
      },
    });
    const inner = createMockEmbedder();
    const sent: { at: number; count: number }[] = [];
    const embedder: Embedder = {
      modelId: inner.modelId,
      embedDocuments(items, signal) {
        sent.push({ at: clock.t, count: items.length });
        return inner.embedDocuments(items, signal);
      },
      embedQuery(query, signal) {
        sent.push({ at: clock.t, count: 1 });
        return inner.embedQuery(query, signal);
      },
    };
    const cache = fileEmbeddingCache(tempDir());
    const needed = await countNewEmbeddings(inner.modelId, corpus, queries, configs, cache);
    const limited = await runRetrievalEval({ embedder, corpus, questions, configs, cache, rateLimiter });

    expect(sent.reduce((n, s) => n + s.count, 0)).toBe(needed); // nothing lost or sent twice
    expect(Math.max(...sent.map((s) => s.count))).toBeLessThanOrEqual(3); // big batches were split
    const peak = Math.max(
      ...sent.map((e) =>
        sent.filter((o) => o.at > e.at - 60_000 && o.at <= e.at).reduce((n, o) => n + o.count, 0),
      ),
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(clock.t).toBeGreaterThanOrEqual(Math.floor((needed - 1) / 3) * 60_000);

    // Same rankings as an unlimited run: limiting changes timing only.
    const free = await runRetrievalEval({
      embedder: createMockEmbedder(),
      corpus,
      questions,
      configs,
      cache: fileEmbeddingCache(tempDir()),
    });
    expect(vectorScores(limited)).toEqual(vectorScores(free));
  }, 60_000);

  it("keys the cache by model, so a different embedding model starts from zero", async () => {
    const dir = tempDir();
    const cache = fileEmbeddingCache(dir);
    const needed = await countNewEmbeddings("mock-hash@768", corpus, queries, configs, cache);
    await runRetrievalEval({ embedder: createMockEmbedder(), corpus, questions, configs, cache });
    expect(await countNewEmbeddings("mock-hash@768", corpus, queries, configs, fileEmbeddingCache(dir))).toBe(
      0,
    );
    expect(
      await countNewEmbeddings("other-model@768", corpus, queries, configs, fileEmbeddingCache(dir)),
    ).toBe(needed);
  }, 60_000);
});
