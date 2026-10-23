import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { DraftResult, InjectionResult, TriageResult } from "../../scripts/lib/ai-smoke";
import { formatMarkdown, type EvalReportFile } from "../../scripts/lib/eval-report";
import { datasetHash, plannedItems, stableHash, type EvalDataset } from "../../scripts/lib/eval-runner";
import { floorValues, loadFloors, summarizeEval, type SavedItem } from "../../scripts/lib/eval-summary";
import { loadInjectionCases } from "../../scripts/lib/injection-cases";
import { loadCorpus, loadQuestions, loadUnanswerable } from "../../scripts/lib/kb-corpus";
import { loadTriageSet } from "../../scripts/lib/triage-set";

const metered = {
  calls: 1,
  latencyMs: 100,
  inputTokens: 10,
  outputTokens: 5,
  estCostMicros: 2,
  providerErrors: [],
};

function triage(
  key: string,
  expected: string,
  got: string | null,
  over: Partial<TriageResult> = {},
): SavedItem {
  const result: TriageResult = {
    key,
    model: "m",
    expected: { category: expected, priority: "high", sentiment: "neutral", language: "en" },
    status: got ? "succeeded" : "failed",
    errorCode: null,
    got: got
      ? { category: got, priority: "urgent", sentiment: "neutral", confidence: 0.9, language: "en" }
      : null,
    needsReview: got ? false : null,
    categoryCorrect: got === expected,
    priorityCorrect: false,
    ...metered,
    ...over,
  };
  return { suite: "triage", failed: !got, result };
}

function draft(
  id: string,
  set: DraftResult["set"],
  status: string,
  over: Partial<DraftResult> = {},
): SavedItem {
  const result: DraftResult = {
    id,
    set,
    question: "?",
    model: "m",
    goldArticle: set === "answerable" ? "a.md" : null,
    status,
    errorCode: null,
    warnings: [],
    modelCalled: true,
    citedTitles: [],
    citationCount: 0,
    citesGold: set === "answerable" ? false : null,
    invalidCitations: 0,
    ttftMs: 50,
    endToEndMs: 200,
    finishReason: "stop",
    modelText: "",
    ...metered,
    ...over,
  };
  return { suite: "draft", failed: status === "failed", result };
}

function injection(id: string, obeyed: boolean, caughtByCode = false): SavedItem {
  const result: InjectionResult = {
    id,
    kind: "direct",
    target: "draft",
    technique: "t",
    model: "m",
    reachedModel: true,
    poisonShown: null,
    outcome: { status: "ready", errorCode: null },
    modelAnswer: "",
    signs: obeyed ? ["canary"] : [],
    obeyed,
    caughtByCode,
    ...metered,
  };
  return { suite: "injection", failed: false, result };
}

const retrieval = (id: string, firstGoldRank: number | null): SavedItem => ({
  suite: "retrieval",
  failed: false,
  result: { id, firstGoldRank, retrieved: [], retrievalMs: 5 },
});

describe("summarizeEval", () => {
  const items: SavedItem[] = [
    retrieval("q1", 1),
    retrieval("q2", 2),
    retrieval("q3", null),
    triage("t1", "billing", "billing"),
    triage("t2", "bug", "billing"),
    triage("t3", "bug", null, { providerErrors: [{ status: 503, message: "overloaded" }] }),
    draft("q1", "answerable", "ready", { citesGold: true, citationCount: 2, invalidCitations: 1 }),
    draft("q2", "answerable", "refused", { modelCalled: false, ttftMs: null }),
    draft("q3", "answerable", "failed"),
    draft("u1", "unanswerable", "refused"),
    draft("u2", "unanswerable", "ready", { citationCount: 1 }),
    injection("D01", false),
    injection("I07", true, true),
  ];
  const s = summarizeEval(items);

  it("scores retrieval: recall@5 with an interval, and MRR as a plain score", () => {
    expect(s.retrieval.recallAt5).toMatchObject({ successes: 2, n: 3 });
    expect(s.retrieval.mrrAt5).toBeCloseTo((1 + 0.5 + 0) / 3, 10);
  });

  it("leaves technical failures out of the quality rates and reports them as an error rate", () => {
    expect(s.triage.errors).toMatchObject({ successes: 1, n: 3 });
    expect(s.triage.category).toMatchObject({ successes: 1, n: 2 });
    expect(s.triage.priorityWithinOne).toMatchObject({ successes: 2, n: 2 }); // high vs urgent
    expect(s.drafts.errors).toMatchObject({ successes: 1, n: 5 });
  });

  it("scores refusals, citations and the right article on the drafts that got an answer", () => {
    expect(s.drafts).toMatchObject({ answerable: 3, unanswerable: 2, refusedBeforeModel: 1 });
    expect(s.drafts.refusalRecall).toMatchObject({ successes: 1, n: 2 });
    expect(s.drafts.falseRefusal).toMatchObject({ successes: 1, n: 2 });
    expect(s.drafts.citesGold).toMatchObject({ successes: 1, n: 1 });
    // 3 citations kept, 1 stripped as invalid.
    expect(s.drafts.citationValidity).toMatchObject({ successes: 3, n: 4 });
  });

  it("lists the injection cases the model obeyed, and which the pipeline caught", () => {
    expect(s.injection.resisted).toMatchObject({ successes: 1, n: 2 });
    expect(s.injection.obeyed).toEqual(["I07"]);
    expect(s.injection.obeyedCaughtByCode).toEqual(["I07"]);
  });

  it("adds up tokens and cost over every model call, failed items included", () => {
    expect(s.cost.calls).toBe(10);
    expect(s.cost.failedCalls).toBe(1);
    expect(s.cost.inputTokens).toBe(100);
  });

  it("reports no data, not zero, for an empty run", () => {
    const empty = summarizeEval([]);
    expect(empty.retrieval.mrrAt5).toBeNull();
    expect(Object.values(floorValues(empty)).every((v) => v === null)).toBe(true);
  });
});

describe("floors", () => {
  it("every floor in eval/floors.json names a metric the runner reports", () => {
    const known = Object.keys(floorValues(summarizeEval([])));
    const floors = loadFloors("eval/floors.json", "mock");
    const named = [...Object.keys(floors.min ?? {}), ...Object.keys(floors.max ?? {})];
    expect(named.length).toBeGreaterThan(10);
    expect(named.filter((m) => !known.includes(m))).toEqual([]);
  });

  it("refuses a provider without floors", () => {
    expect(() => loadFloors("eval/floors.json", "gemini")).toThrow(/no floors for --provider gemini/);
  });
});

describe("run identity", () => {
  it("hashes the same content the same way whatever the key order", () => {
    expect(stableHash({ a: 1, b: [{ c: 2, d: 3 }] })).toBe(stableHash({ b: [{ d: 3, c: 2 }], a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
    expect(stableHash({ a: 1, b: undefined })).toBe(stableHash({ a: 1 }));
  });

  const dataset: EvalDataset = {
    corpus: loadCorpus(),
    triage: loadTriageSet(),
    answerable: loadQuestions(),
    unanswerable: loadUnanswerable(),
    injection: loadInjectionCases(),
  };

  it("changes the dataset hash when a single label changes", () => {
    const relabelled = {
      ...dataset,
      triage: dataset.triage.map((t, i) =>
        i === 5 ? { ...t, expected: { ...t.expected, priority: "low" } } : t,
      ),
    } as EvalDataset;
    expect(datasetHash(relabelled)).not.toBe(datasetHash(dataset));
  });

  it("plans every item once, with no id shared within a suite", () => {
    const plan = plannedItems(dataset);
    const answerable = dataset.answerable.length;
    expect(plan).toHaveLength(answerable + 150 + answerable + dataset.unanswerable.length + 20);
    expect(new Set(plan.map((p) => `${p.suite}:${p.key}`)).size).toBe(plan.length);
    expect(plan.every((p) => /^[A-Za-z0-9-]{1,40}$/.test(p.key))).toBe(true);
  });
});

describe("formatMarkdown", () => {
  const report = (provider: string, floors: EvalReportFile["floors"]): EvalReportFile => ({
    run: {
      id: "82975ef1-0000-4000-8000-000000000000",
      provider,
      status: "completed",
      stopReason: null,
      startedAt: "2026-10-23T09:00:00.000Z",
      finishedAt: "2026-10-23T09:00:13.000Z",
      calls: 309,
      datasetHash: "a".repeat(64),
      configHash: "b".repeat(64),
      config: {
        promptVersions: { triage: "triage.v1", draft: "draft.v1" },
        models: { triage: "t-model", draft: "d-model", draftFallback: "f-model" },
        embeddingModel: "e-model",
      },
    },
    floors,
    summary: summarizeEval([retrieval("q1", 1), triage("t1", "bug", "bug")]),
    items: [],
  });

  it("tags the run and says plainly that mock numbers are not AI quality", () => {
    const md = formatMarkdown(report("mock", { checked: false, failures: [] }));
    expect(md).toContain("# Evaluation run 82975ef1 (mock)");
    expect(md).toContain("triage.v1, draft.v1");
    expect(md).toContain("triage t-model, drafts d-model, fallback f-model");
    expect(md).toContain("They say nothing about AI quality");
    expect(md).toContain("| Retrieval recall@5 | 100.0% (");
    expect(md).toContain("| Refusal recall | no data | ≥ 90% |");
    expect(md).toContain("Not checked in this run.");
  });

  it("leaves the mock note out of real runs and lists missed floors", () => {
    const md = formatMarkdown(
      report("gemini", {
        checked: true,
        failures: [
          { metric: "triage.category", kind: "min", limit: 0.85, actual: 0.8 },
          { metric: "drafts.falseRefusal", kind: "max", limit: 0.1, actual: null },
        ],
      }),
    );
    expect(md).not.toContain("Mock run");
    expect(md).toContain("| triage.category | ≥ 0.85 | 0.800 |");
    expect(md).toContain("| drafts.falseRefusal | ≤ 0.1 | no data |");
  });

  it("says when every floor passed", () => {
    expect(formatMarkdown(report("mock", { checked: true, failures: [] }))).toContain(
      "Every floor in `eval/floors.json` passed.",
    );
  });
});

describe("eval/floors.json", () => {
  it("is valid JSON that explains how to change a floor", () => {
    const raw = JSON.parse(readFileSync("eval/floors.json", "utf8")) as { about: string };
    expect(raw.about).toMatch(/update the floor in the same commit/);
  });
});
