import { describe, expect, it } from "vitest";

import {
  decideTriagePrompt,
  TRIAGE_COMPARE_ALPHA,
  triageCorrectness,
  type TriageCorrectness,
  type TriageItemLike,
} from "../../scripts/lib/triage-compare";

/**
 * The v1 vs v2 decision (M6 plan D6a). The rule was fixed before any Gemini data: adopt v2 only
 * if category or exact priority is higher with exact McNemar p < 0.025, and neither is lower
 * with p < 0.025.
 */
const item = (key: string, category: boolean, priority: boolean, extra: Partial<TriageItemLike> = {}) =>
  ({
    suite: "triage",
    failed: false,
    result: { key, status: "succeeded", categoryCorrect: category, priorityCorrect: priority },
    ...extra,
  }) satisfies TriageItemLike;

/** n tickets; `right` decides each version's correctness per ticket index. */
function versions(
  n: number,
  right: (i: number) => { v1: [boolean, boolean]; v2: [boolean, boolean] },
): [TriageCorrectness, TriageCorrectness] {
  const a: TriageItemLike[] = [];
  const b: TriageItemLike[] = [];
  for (let i = 0; i < n; i++) {
    const r = right(i);
    a.push(item(`t${i}`, ...r.v1));
    b.push(item(`t${i}`, ...r.v2));
  }
  return [triageCorrectness(a), triageCorrectness(b)];
}

describe("triageCorrectness", () => {
  it("reads category and priority per ticket, leaving out failures and non-triage items", () => {
    const c = triageCorrectness([
      item("a", true, false),
      item("b", false, true),
      item("c", true, true, { failed: true }),
      { suite: "triage", failed: false, result: { key: "d", status: "failed" } },
      { suite: "draft", failed: false, result: { key: "e", status: "succeeded" } },
    ]);
    expect([...c.category]).toEqual([
      ["a", true],
      ["b", false],
    ]);
    expect([...c.priority]).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  it("refuses a run that lists a ticket twice", () => {
    expect(() => triageCorrectness([item("a", true, true), item("a", false, false)])).toThrow(/twice/);
  });
});

describe("decideTriagePrompt", () => {
  it("uses 0.05 split over the two metrics", () => {
    expect(TRIAGE_COMPARE_ALPHA).toBe(0.025);
  });

  it("keeps v1 when the versions agree", () => {
    const [v1, v2] = versions(150, (i) => ({
      v1: [i % 7 !== 0, i % 4 !== 0],
      v2: [i % 7 !== 0, i % 4 !== 0],
    }));
    const d = decideTriagePrompt(v1, v2);
    expect(d.verdict).toBe("keep-v1-no-difference");
    expect(d.category).toMatchObject({ n: 150, onlyA: 0, onlyB: 0, pValue: 1 });
  });

  it("adopts v2 when it is clearly better on priority and not worse on category", () => {
    // Priority: v2 alone right on 12 tickets, v1 alone on 1 (p ≈ 0.0034); category identical.
    const [v1, v2] = versions(150, (i) => ({ v1: [true, i >= 12], v2: [true, i !== 148] }));
    const d = decideTriagePrompt(v1, v2);
    expect(d.priority).toMatchObject({ onlyA: 1, onlyB: 12 });
    expect(d.priority.pValue).toBeLessThan(0.025);
    expect(d.verdict).toBe("adopt-v2");
  });

  it("keeps v1 when v2 is better on one metric but clearly worse on the other", () => {
    // Category: v1 alone right on 12; priority: v2 alone right on 12.
    const [v1, v2] = versions(150, (i) => ({ v1: [true, i >= 12], v2: [i >= 12, true] }));
    const d = decideTriagePrompt(v1, v2);
    expect(d.category.v2Worse).toBe(true);
    expect(d.priority.v2Better).toBe(true);
    expect(d.verdict).toBe("keep-v1-v2-worse");
  });

  it("does not adopt v2 on a difference that could be chance (p ≈ 0.065)", () => {
    // 9 vs 2 discordant tickets: p ≈ 0.065, which would pass at 0.07 but not at 0.025.
    const [v1, v2] = versions(150, (i) => ({ v1: [i >= 9, true], v2: [i !== 140 && i !== 141, true] }));
    const d = decideTriagePrompt(v1, v2);
    expect(d.category).toMatchObject({ onlyA: 2, onlyB: 9 });
    expect(d.category.pValue).toBeGreaterThan(0.025);
    expect(d.verdict).toBe("keep-v1-no-difference");
  });

  it("pairs only tickets both versions answered, and rates each on those tickets", () => {
    const v1 = triageCorrectness([item("a", true, true), item("b", false, true), item("c", true, true)]);
    const v2 = triageCorrectness([item("a", true, false), item("b", true, true)]);
    const d = decideTriagePrompt(v1, v2);
    expect(d.category).toMatchObject({ n: 2, bothRight: 1, onlyA: 0, onlyB: 1 });
    expect(d.category.v1).toMatchObject({ n: 2, rate: 0.5 });
    expect(d.category.v2).toMatchObject({ n: 2, rate: 1 });
  });
});
