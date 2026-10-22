import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  goldChunks,
  normalizeForMatch,
  percentile,
  scoreRanking,
  summarizeScores,
} from "@/server/modules/eval/retrieval-metrics";
import { prepareDocument } from "@/server/modules/kb/prepare";

import {
  CORPUS_DIR,
  loadCorpus,
  loadQuestions,
  markdownToPdfPages,
  questionTargets,
} from "../../scripts/lib/kb-corpus";

describe("normalizeForMatch", () => {
  it("ignores case, whitespace, emphasis and curly quotes", () => {
    expect(normalizeForMatch("For **30 days**\n  you can’t")).toBe(
      normalizeForMatch("for 30 days you can't"),
    );
    expect(normalizeForMatch("`NC-403`: Permission")).toBe("nc-403:permission");
  });
});

describe("goldChunks", () => {
  const chunks = [
    { id: "a1", article: "a.md", content: "Refunds take **5 to 10** business days." },
    { id: "a2", article: "a.md", content: "Monthly plans are not refunded." },
    { id: "b1", article: "b.md", content: "Refunds take 5 to 10 business days." },
  ];

  it("only counts chunks of the labelled article that contain the phrase", () => {
    const gold = goldChunks(chunks, [{ article: "a.md", evidence: "refunds take 5 to 10 business days" }]);
    expect([...gold.ids]).toEqual(["a1"]);
    expect(gold.split).toBe(false);
    expect(gold.missing).toEqual([]);
  });

  it("unions the targets of a question with several acceptable passages", () => {
    const gold = goldChunks(chunks, [
      { article: "a.md", evidence: "not refunded" },
      { article: "b.md", evidence: "business days" },
    ]);
    expect([...gold.ids].sort()).toEqual(["a2", "b1"]);
  });

  it("falls back to the chunks holding the first or last words when chunking split the phrase", () => {
    const split = [
      { id: "c1", article: "c.md", content: "Annual plans can be refunded in full" },
      { id: "c2", article: "c.md", content: "within 30 days of purchase or renewal." },
      { id: "c3", article: "c.md", content: "Something else." },
    ];
    const gold = goldChunks(split, [
      { article: "c.md", evidence: "Annual plans can be refunded in full within 30 days of purchase" },
    ]);
    expect([...gold.ids].sort()).toEqual(["c1", "c2"]);
    expect(gold.split).toBe(true);
  });

  it("reports labels whose words are not in the article", () => {
    const target = { article: "a.md", evidence: "a phrase that appears nowhere at all" };
    const gold = goldChunks(chunks, [target]);
    expect(gold.ids.size).toBe(0);
    expect(gold.missing).toEqual([target]);
    // Short phrases have no edge fallback.
    expect(goldChunks(chunks, [{ article: "a.md", evidence: "absent words" }]).missing).toHaveLength(1);
  });
});

describe("scoreRanking and summarizeScores", () => {
  const gold = new Set(["g"]);

  it("finds the first gold chunk within the top k", () => {
    expect(scoreRanking(["x", "g", "g"], gold, 5)).toEqual({
      firstGoldRank: 2,
      hit: true,
      reciprocalRank: 0.5,
    });
    expect(scoreRanking(["g"], gold, 5).reciprocalRank).toBe(1);
  });

  it("ignores gold chunks below rank k", () => {
    expect(scoreRanking(["a", "b", "c", "d", "e", "g"], gold, 5)).toEqual({
      firstGoldRank: null,
      hit: false,
      reciprocalRank: 0,
    });
  });

  it("averages recall and reciprocal rank", () => {
    const s = summarizeScores([
      scoreRanking(["g"], gold, 5),
      scoreRanking(["x", "x", "x", "g"], gold, 5),
      scoreRanking([], gold, 5),
      scoreRanking(["x", "g"], gold, 5),
    ]);
    expect(s.questions).toBe(4);
    expect(s.recallAtK).toBe(0.75);
    expect(s.mrrAtK).toBeCloseTo((1 + 0.25 + 0 + 0.5) / 4);
    expect(summarizeScores([])).toEqual({ questions: 0, recallAtK: 0, mrrAtK: 0 });
  });
});

describe("percentile", () => {
  it("uses the nearest-rank method", () => {
    const values = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 95)).toBe(10);
    expect(percentile(values, 0)).toBe(1);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 50)).toBe(0);
    expect(() => percentile(values, 101)).toThrow(RangeError);
  });
});

describe("markdownToPdfPages", () => {
  it("drops Markdown markers, wraps long lines and paginates", () => {
    const md = `# Title\n\nSome **bold** text.\n\n\n${"word ".repeat(40).trim()}\n${"line\n".repeat(60)}`;
    const pages = markdownToPdfPages(md);
    expect(pages[0]!.slice(0, 3)).toEqual(["Title", "", "Some bold text."]);
    expect(pages.flat().every((l) => l.length <= 80)).toBe(true);
    expect(pages.flat().filter((l) => l.startsWith("word")).length).toBe(3);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((p) => p.length <= 46)).toBe(true);
  });

  it("refuses text the Latin-1 PDF writer would garble", () => {
    expect(() => markdownToPdfPages("Settings › Billing")).toThrow(/ASCII/);
  });
});

describe("the Nimbus eval corpus and questions", () => {
  const corpus = loadCorpus();
  const questions = loadQuestions();
  const byFile = new Map(corpus.map((a) => [a.file, a]));

  it("lists every article in the folder exactly once, and never the poisoned one", () => {
    const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".md"));
    expect(corpus.map((a) => a.file).sort()).toEqual(files.sort());
    expect(corpus.length).toBeGreaterThanOrEqual(30);
    expect(corpus.some((a) => /poison|refund-exceptions/.test(a.file))).toBe(false);
    for (const a of corpus) expect(a.source.startsWith(`# ${a.title}\n`)).toBe(true);
  });

  it("keeps the poisoned article out of the corpus folder", () => {
    const poisoned = readFileSync(path.join(CORPUS_DIR, "../poisoned/refund-exceptions.md"), "utf8");
    expect(poisoned).toMatch(/ignore all previous instructions/i);
    for (const a of corpus) expect(a.source).not.toMatch(/ignore all previous instructions/i);
  });

  it("has a question for every article, and every label points at real text", () => {
    expect(questions.length).toBeGreaterThanOrEqual(80);
    const covered = new Set(questions.map((q) => q.article));
    expect([...byFile.keys()].filter((f) => !covered.has(f))).toEqual([]);
    for (const q of questions) {
      for (const t of questionTargets(q)) {
        const article = byFile.get(t.article);
        expect(article, `${q.id}: unknown article ${t.article}`).toBeDefined();
        expect(normalizeForMatch(article!.source), `${q.id}: evidence not in ${t.article}`).toContain(
          normalizeForMatch(t.evidence),
        );
      }
    }
  });

  it("builds multi-page PDFs whose every line survives extraction and chunking", async () => {
    const pdfs = corpus.filter((a) => a.format === "pdf");
    expect(pdfs.length).toBeGreaterThanOrEqual(3);
    for (const a of pdfs) {
      expect(a.mimeType).toBe("application/pdf");
      const pages = markdownToPdfPages(a.source);
      const prepared = await prepareDocument(a.mimeType, a.bytes);
      expect(prepared.pageCount).toBe(pages.length);
      expect(pages.length).toBeGreaterThan(1);
      const text = normalizeForMatch(prepared.chunks.map((c) => c.content).join(" "));
      for (const line of pages.flat().filter((l) => l !== "")) {
        expect(text, `${a.file}: "${line}"`).toContain(normalizeForMatch(line));
      }
      for (const q of questions.filter((q) => q.article === a.file)) {
        expect(text, q.id).toContain(normalizeForMatch(q.evidence));
      }
    }
  });
});
