import { describe, expect, it } from "vitest";
import { compareRuns, settingsChanges } from "@/server/modules/eval/summary-view";

const rate = (successes: number, n: number, low: number, high: number) => ({
  successes,
  n,
  rate: successes / n,
  low,
  high,
});

describe("comparing two evaluation runs", () => {
  it("calls a change better or worse only when the 95% ranges don't overlap", () => {
    const older = {
      triage: { category: rate(131, 150, 0.81, 0.92), sentiment: rate(140, 150, 0.88, 0.96) },
      drafts: { falseRefusal: rate(2, 110, 0.005, 0.064) },
    };
    const newer = {
      triage: { category: rate(149, 150, 0.963, 0.999), sentiment: rate(138, 150, 0.86, 0.95) },
      drafts: { falseRefusal: rate(20, 110, 0.12, 0.26) },
    };
    const byKey = Object.fromEntries(compareRuns(newer, older).map((c) => [c.def.key, c]));
    expect(byKey.category).toMatchObject({ verdict: "better" });
    expect(byKey.category!.delta).toBeCloseTo(18 / 150);
    expect(byKey.sentiment).toMatchObject({ verdict: "unclear" }); // overlapping ranges
    // Lower is better for wrong refusals: a clear rise is worse.
    expect(byKey.falseRefusal).toMatchObject({ verdict: "worse" });
  });

  it("leaves out metrics only one run measured, and marks equal values as unchanged", () => {
    const older = { triage: { category: rate(130, 150, 0.8, 0.92) } };
    const newer = {
      triage: { category: rate(130, 150, 0.8, 0.92) },
      retrieval: { recallAt5: rate(109, 110, 0.95, 0.998) },
    };
    const changes = compareRuns(newer, older);
    expect(changes.map((c) => [c.def.key, c.verdict])).toEqual([["category", "same"]]);
  });

  it("treats malformed summaries as no data instead of failing", () => {
    expect(compareRuns({ triage: { category: { rate: 9 } } }, null)).toEqual([]);
  });

  it("lists the prompt versions and models that differ", () => {
    const older = { promptVersions: { triage: "triage.v1", draft: "draft.v1" }, models: { draft: "m-1" } };
    const newer = {
      promptVersions: { triage: "triage.v2", draft: "draft.v1" },
      models: { draft: "m-1", grader: "g" },
    };
    expect(settingsChanges(newer, older)).toEqual([
      "triage prompt: triage.v1 → triage.v2",
      "grader model: none → g",
    ]);
    expect(settingsChanges({ promptVersions: { x: 5 } }, undefined)).toEqual([]);
  });
});
