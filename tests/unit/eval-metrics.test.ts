import { describe, expect, it } from "vitest";

import {
  accuracy,
  checkFloors,
  confusion,
  macroF1,
  spread,
  withinOneLevel,
} from "@/server/modules/eval/metrics";

const pair = (expected: string, got: string | null) => ({ expected, got });
const LEVELS = ["low", "normal", "high", "urgent"] as const;

describe("accuracy", () => {
  it("counts exact matches, and a missing answer as wrong", () => {
    const r = accuracy([pair("bug", "bug"), pair("bug", "billing"), pair("how-to", null), pair("a", "a")]);
    expect(r.successes).toBe(2);
    expect(r.n).toBe(4);
    expect(r.rate).toBe(0.5);
    expect(r.low).toBeGreaterThan(0);
    expect(r.high).toBeLessThan(1);
  });

  it("reports no data, not 0%, for an empty set", () => {
    expect(accuracy([]).rate).toBeNull();
  });
});

describe("withinOneLevel", () => {
  it("accepts a neighbouring level but not two levels away", () => {
    const r = withinOneLevel(
      [pair("urgent", "high"), pair("urgent", "urgent"), pair("urgent", "low"), pair("low", "normal")],
      LEVELS,
    );
    expect(r.successes).toBe(3);
    expect(r.n).toBe(4);
  });

  it("counts a missing answer as a miss", () => {
    expect(withinOneLevel([pair("high", null)], LEVELS).successes).toBe(0);
  });

  it("rejects a level outside the scale instead of guessing", () => {
    expect(() => withinOneLevel([pair("high", "critical")], LEVELS)).toThrow(/Unknown level "critical"/);
  });
});

describe("macroF1", () => {
  it("averages per-label F1 without weighting by size", () => {
    // a: 1 of 1 predictions right, 1 of 2 found -> P 1, R 0.5, F1 2/3.
    // b: 1 of 2 predictions right, 1 of 2 found -> P 0.5, R 0.5, F1 0.5.
    // c: no tickets -> listed, left out of the mean.
    const m = macroF1([pair("a", "a"), pair("a", "b"), pair("b", "b"), pair("b", null)], ["a", "b", "c"]);
    const [a, b, c] = m.perLabel;
    expect(a).toMatchObject({ label: "a", support: 2, precision: 1, recall: 0.5 });
    expect(a!.f1).toBeCloseTo(2 / 3, 10);
    expect(b).toMatchObject({ precision: 0.5, recall: 0.5, f1: 0.5 });
    expect(c).toEqual({ label: "c", support: 0, precision: null, recall: null, f1: null });
    expect(m.macroF1).toBeCloseTo((2 / 3 + 0.5) / 2, 10);
  });

  it("gives F1 0 to a label the model never predicted", () => {
    const m = macroF1([pair("a", "b"), pair("b", "b")], ["a", "b"]);
    expect(m.perLabel[0]).toMatchObject({ precision: null, recall: 0, f1: 0 });
    expect(m.macroF1).toBeCloseTo((0 + 2 / 3) / 2, 10);
  });

  it("has no score without data", () => {
    expect(macroF1([], ["a"]).macroF1).toBeNull();
  });
});

describe("confusion", () => {
  it("counts expected-by-got, with (none) for missing answers", () => {
    expect(
      confusion([pair("bug", "bug"), pair("bug", "billing"), pair("bug", null), pair("bug", "bug")]),
    ).toEqual({ bug: { bug: 2, billing: 1, "(none)": 1 } });
  });
});

describe("spread", () => {
  it("gives nearest-rank p50 and p95 in whole milliseconds", () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1 + 0.4); // 1.4 … 20.4
    expect(spread(values)).toEqual({ n: 20, p50: 10, p95: 19 });
  });

  it("is empty without values", () => {
    expect(spread([])).toEqual({ n: 0, p50: null, p95: null });
  });
});

describe("checkFloors", () => {
  const floors = {
    min: { "triage.category": 0.8, "retrieval.recall": 0.9 },
    max: { "drafts.falseRefusal": 0.1 },
  };

  it("passes when every metric is on the right side of its limit (limits included)", () => {
    expect(
      checkFloors({ "triage.category": 0.8, "retrieval.recall": 0.95, "drafts.falseRefusal": 0.1 }, floors),
    ).toEqual([]);
  });

  it("lists every metric below a minimum or above a maximum", () => {
    expect(
      checkFloors({ "triage.category": 0.79, "retrieval.recall": 0.95, "drafts.falseRefusal": 0.2 }, floors),
    ).toEqual([
      { metric: "triage.category", kind: "min", limit: 0.8, actual: 0.79 },
      { metric: "drafts.falseRefusal", kind: "max", limit: 0.1, actual: 0.2 },
    ]);
  });

  it("fails a floor the run did not measure, so a skipped suite cannot pass silently", () => {
    expect(checkFloors({ "triage.category": null }, { min: { "triage.category": 0.5, "x.y": 0 } })).toEqual([
      { metric: "triage.category", kind: "min", limit: 0.5, actual: null },
      { metric: "x.y", kind: "min", limit: 0, actual: null },
    ]);
  });
});
