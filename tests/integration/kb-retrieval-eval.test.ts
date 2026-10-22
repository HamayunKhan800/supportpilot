import { like } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_CHUNK_OPTIONS } from "@/server/modules/kb/chunker";
import { createMockEmbedder } from "@/server/modules/kb/embedder";
import { getDb } from "@/server/platform/db/client";
import { aiUsage, kbDocument, organization } from "@/server/platform/db/schema";

import { loadCorpus, loadQuestions, loadUnanswerable } from "../../scripts/lib/kb-corpus";
import { type EvalReport, runRetrievalEval } from "../../scripts/lib/retrieval-eval";
import { resetDatabase } from "./support/client";

/**
 * CI guard for retrieval quality (plan M4 step 6). Runs the real eval (production ingest
 * job, chunker, PDF extraction, hybridSearch) with the deterministic mock embedder at the
 * default chunking, and fails if any mode drops below its floor.
 *
 * The mock embedder is a hashed bag of words, so these numbers are a word-matching
 * baseline, not the product's quality: docs/eval/retrieval-baseline.md has the Gemini run.
 * Floors sit about two questions below the lowest of 6 runs, because keyword ties are
 * broken by chunk id (a random UUID), which moves keyword and hybrid by about one question
 * between runs. Vector search with the mock is exactly repeatable.
 */
const FLOORS = {
  hybrid: { recall: 0.8, mrr: 0.64 },
  vector: { recall: 0.83, mrr: 0.59 },
  keyword: { recall: 0.77, mrr: 0.54 },
} as const;

let report: EvalReport;

beforeAll(async () => {
  await resetDatabase();
  report = await runRetrievalEval({
    embedder: createMockEmbedder(),
    corpus: loadCorpus(),
    questions: loadQuestions(),
    configs: [DEFAULT_CHUNK_OPTIONS],
    unanswerable: loadUnanswerable(),
  });
}, 120_000);

const mode = (name: keyof typeof FLOORS) => report.configs[0]!.modes.find((m) => m.mode === name)!;

describe("retrieval eval (mock embedder, default chunking)", () => {
  it.each(Object.keys(FLOORS) as (keyof typeof FLOORS)[])("%s stays above its floor", (name) => {
    const m = mode(name);
    expect(m.questions).toHaveLength(report.questionCount);
    expect(m.recallAtK).toBeGreaterThanOrEqual(FLOORS[name].recall);
    expect(m.mrrAtK).toBeGreaterThanOrEqual(FLOORS[name].mrr);
  });

  it("fusion ranks the right passage higher than either search alone", () => {
    // If keyword search broke, hybrid would quietly become vector-only: same recall, lower MRR.
    expect(mode("hybrid").mrrAtK).toBeGreaterThan(mode("vector").mrrAtK + 0.03);
    expect(mode("hybrid").mrrAtK).toBeGreaterThan(mode("keyword").mrrAtK + 0.03);
  });

  it("ingests every article, PDFs included, without splitting any evidence", () => {
    const config = report.configs[0]!;
    expect(report.documentCount).toBe(loadCorpus().length);
    expect(config.chunkCount).toBeGreaterThan(report.documentCount);
    expect(config.splitEvidence).toEqual([]);
    expect(report.queryEmbedMs.calls).toBe(report.questionCount + loadUnanswerable().length); // each once, cached across modes
    expect(report.estCostMicros).toBe(0); // the mock is free
  });

  it("saves what search finds for each unanswerable question, for the human check", () => {
    const result = report.configs[0]!.unanswerable!;
    const articles = new Set(loadCorpus().map((a) => a.file));
    expect(result.questions.map((q) => q.id)).toEqual(loadUnanswerable().map((q) => q.id));
    for (const q of result.questions) {
      expect(q.vector).toHaveLength(report.k);
      const sims = q.vector.map((p) => p.similarity!);
      expect(sims).toEqual([...sims].sort((a, b) => b - a));
      expect(result.unanswerableTop1.max).toBeGreaterThanOrEqual(sims[0]!);
      for (const p of [...q.vector, ...q.keyword]) {
        expect(articles.has(p.article)).toBe(true);
        expect(p.content.length).toBeGreaterThan(0);
      }
    }
    for (const s of [result.answerableTop1, result.unanswerableTop1]) {
      expect(s.min).toBeLessThanOrEqual(s.p50);
      expect(s.p50).toBeLessThanOrEqual(s.max);
    }
  });

  it("removes its temporary workspace and everything in it", async () => {
    const { db } = getDb();
    expect(await db.select().from(organization).where(like(organization.slug, "retrieval-eval-%"))).toEqual(
      [],
    );
    expect(await db.select().from(kbDocument)).toEqual([]);
    expect(await db.select().from(aiUsage)).toEqual([]);
  });
});
