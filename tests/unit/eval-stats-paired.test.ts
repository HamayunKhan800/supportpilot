import { describe, expect, it } from "vitest";

import { comparePaired, mcnemarExact } from "@/server/modules/eval/stats";

/**
 * The exact McNemar test used to compare triage prompts v1 and v2 on the same tickets (M6 D6).
 * Expected values were computed separately with Python's exact integers:
 * min(1, 2 * sum(comb(n, i) for i in range(min(b, c) + 1)) / 2**n).
 */
describe("mcnemarExact", () => {
  it.each([
    [2, 8, 0.109375], // the worked example in the McNemar literature: p ≈ .109
    [8, 2, 0.109375], // symmetric
    [0, 5, 0.0625],
    [1, 9, 0.021484375],
    [10, 25, 0.01667384780012071],
    [30, 10, 0.0022214337732293643],
  ])("b=%i, c=%i gives p=%f", (b, c, p) => {
    expect(mcnemarExact(b, c)).toBeCloseTo(p, 12);
  });

  it("is 1 when the versions disagree equally often, or never", () => {
    expect(mcnemarExact(5, 5)).toBe(1);
    expect(mcnemarExact(3, 4)).toBe(1); // 2 x tail > 1 is capped
    expect(mcnemarExact(0, 0)).toBe(1);
  });

  it("handles the largest counts a 150-ticket set can give", () => {
    expect(mcnemarExact(75, 75)).toBe(1);
    expect(mcnemarExact(0, 150)).toBeCloseTo(2 * 0.5 ** 150, 60);
    expect(mcnemarExact(0, 150)).toBeGreaterThan(0);
  });

  it("rejects counts that aren't whole, non-negative numbers, or too large to compute", () => {
    expect(() => mcnemarExact(-1, 2)).toThrow(RangeError);
    expect(() => mcnemarExact(1.5, 2)).toThrow(RangeError);
    expect(() => mcnemarExact(600, 600)).toThrow(/up to 1000/);
  });
});

describe("comparePaired", () => {
  it("counts only items both versions answered, and tests the ones they disagree on", () => {
    const a = new Map([
      ["t1", true],
      ["t2", true],
      ["t3", false],
      ["t4", false],
      ["t5", true], // missing from b: a technical failure there, so left out
    ]);
    const b = new Map([
      ["t1", true],
      ["t2", false],
      ["t3", true],
      ["t4", false],
      ["t6", true], // missing from a
    ]);
    expect(comparePaired(a, b)).toEqual({ n: 4, bothRight: 1, onlyA: 1, onlyB: 1, bothWrong: 1, pValue: 1 });
  });

  it("finds a clear difference on the same items that two separate intervals would call a tie", () => {
    // 150 tickets: A right on 120, B right on 132; B fixes 12 and breaks none.
    const keys = Array.from({ length: 150 }, (_, i) => `t${i}`);
    const a = new Map(keys.map((k, i) => [k, i < 120]));
    const b = new Map(keys.map((k, i) => [k, i < 132]));
    const r = comparePaired(a, b);
    expect(r).toMatchObject({ n: 150, onlyA: 0, onlyB: 12, bothRight: 120, bothWrong: 18 });
    expect(r.pValue).toBeCloseTo(2 * 0.5 ** 12, 12); // ≈ 0.0005
    // Wilson 95%: 120/150 = 73–86%, 132/150 = 82–92%: they overlap.
  });
});
