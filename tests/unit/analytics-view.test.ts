import { describe, expect, it } from "vitest";

import { barLayout, lineSegments, niceMax, position } from "@/components/charts/scale";
import {
  formatDay,
  formatMicros,
  formatMs,
  formatRatio,
  formatShare,
  formatUsd,
  NO_DATA,
} from "@/lib/format";
import { DEFAULT_ANALYTICS_PERIOD, parsePeriod, parseProvider } from "@/server/modules/analytics/periods";
import {
  EVAL_METRICS,
  itemsMeasured,
  meetsTarget,
  metricValues,
  numberAt,
  rateAt,
  runLabels,
  spreadAt,
  stringListAt,
} from "@/server/modules/eval/summary-view";
import { GROUNDEDNESS_LABEL } from "@/server/modules/eval/grader";
import { wilson } from "@/server/modules/eval/stats";

/** The analytics dashboard's pure parts (M6 step 5): URL options, formatting, chart geometry, summaries. */

describe("parsePeriod", () => {
  it("accepts exactly the offered windows", () => {
    expect(parsePeriod("7")).toBe(7);
    expect(parsePeriod("30")).toBe(30);
    expect(parsePeriod("90")).toBe(90);
    expect(parsePeriod(["90", "7"])).toBe(90);
  });

  it.each([undefined, "", "14", "365", "07", "7.0", " 7", "-7", "1e1", "9999", "abc", 7, null])(
    "anything else (%j) gets the default",
    (value) => {
      expect(parsePeriod(value)).toBe(DEFAULT_ANALYTICS_PERIOD);
    },
  );

  it("treats a leading zero as not offered, not as 7", () => {
    // "07" is a different URL from "7"; normalising it would make two URLs for one page.
    expect(parsePeriod("07")).toBe(30);
  });
});

describe("parseProvider", () => {
  it("accepts the known providers and nothing else", () => {
    expect(parseProvider("gemini")).toBe("gemini");
    expect(parseProvider("mock")).toBe("mock");
    expect(parseProvider(["mock"])).toBe("mock");
    for (const v of [undefined, "", "Gemini", "openai", "__proto__", 1]) expect(parseProvider(v)).toBeNull();
  });
});

describe("formatting", () => {
  it("shares and ratios, with no data instead of 0 or NaN", () => {
    expect(formatShare(0.873)).toBe("87%");
    expect(formatShare(0.873, 1)).toBe("87.3%");
    expect(formatShare(1)).toBe("100%");
    expect(formatShare(null)).toBe(NO_DATA);
    expect(formatShare(Number.NaN)).toBe(NO_DATA);
    expect(formatRatio(3, 4)).toBe("75%");
    expect(formatRatio(0, 0)).toBe(NO_DATA);
  });

  it("durations", () => {
    expect(formatMs(850)).toBe("850 ms");
    expect(formatMs(999.6)).toBe("1000 ms");
    expect(formatMs(1234)).toBe("1.2 s");
    expect(formatMs(64800)).toBe("64.8 s");
    expect(formatMs(null)).toBe(NO_DATA);
  });

  it("small AI costs never read as a misleading $0.0000", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.00004)).toBe("under $0.0001");
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(1.256)).toBe("$1.26");
    expect(formatUsd(null)).toBe(NO_DATA);
    expect(formatMicros(4200)).toBe("$0.0042");
  });

  it("days are UTC calendar days", () => {
    expect(formatDay("2026-10-23")).toBe("23 Oct");
    expect(formatDay("2026-01-01")).toBe("1 Jan");
    expect(formatDay("not a day")).toBe("not a day");
  });
});

describe("chart geometry", () => {
  it("niceMax rounds up to 1, 2, 2.5 or 5 times a power of ten", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-3)).toBe(1);
    expect(niceMax(Number.NaN)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(13461)).toBe(20000);
    expect(niceMax(0.3)).toBe(0.5);
    expect(niceMax(0.2)).toBe(0.2);
    expect(niceMax(2.1)).toBe(2.5);
    expect(niceMax(250)).toBe(250);
  });

  it("bars fill the box, scale to the max and stand on the baseline", () => {
    const bars = barLayout([0, 5, 10], { width: 30, height: 100, gap: 0.2, max: 10 });
    expect(bars).toHaveLength(3);
    expect(bars[0]).toMatchObject({ height: 0, y: 100 });
    expect(bars[1]!.height).toBeCloseTo(50);
    expect(bars[2]).toMatchObject({ height: 100, y: 0 });
    for (const [i, b] of bars.entries()) {
      expect(b.width).toBeCloseTo(8);
      expect(b.x).toBeCloseTo(i * 10 + 1); // centred in its 10-wide slot
      expect(b.y + b.height).toBeCloseTo(100);
    }
  });

  it("a small non-zero value stays visible, and values above the max are clipped", () => {
    const [small, big] = barLayout([1, 500], { width: 20, height: 100, minHeight: 2, max: 100 });
    expect(small!.height).toBe(2);
    expect(big!.height).toBe(100);
    expect(barLayout([], { width: 10, height: 10 })).toEqual([]);
  });

  it("positions clamp to the axis", () => {
    expect(position(0.5, 100)).toBe(50);
    expect(position(-1, 100)).toBe(0);
    expect(position(2, 100)).toBe(100);
  });

  it("a run with no data splits the line instead of dropping to zero", () => {
    const segs = lineSegments([0.5, null, 1, 0], { width: 30, height: 10 });
    expect(segs).toEqual([
      [{ x: 0, y: 5 }],
      [
        { x: 20, y: 0 },
        { x: 30, y: 10 },
      ],
    ]);
    expect(lineSegments([0.25], { width: 100, height: 40 })).toEqual([[{ x: 50, y: 30 }]]);
  });
});

describe("reading stored evaluation summaries", () => {
  const summary = {
    items: { retrieval: 110, triage: 150, draft: 140, injection: 20 },
    retrieval: { recallAt5: wilson(93, 110), mrrAt5: 0.607, latencyMs: { n: 110, p50: 5, p95: 6 } },
    triage: { category: wilson(69, 150), categoryF1: { macroF1: 0.472 }, errors: wilson(0, 150) },
    drafts: { falseRefusal: wilson(0, 110), refusalRecall: wilson(2, 30), groundedness: wilson(138, 138) },
    injection: { resisted: wilson(18, 20), obeyed: ["D09", "I07"] },
    cost: { estCostUsd: 0.31 },
  };

  it("reads rates, spreads, numbers and lists where they are", () => {
    expect(rateAt(summary, "triage.category")).toMatchObject({ successes: 69, n: 150 });
    expect(spreadAt(summary, "retrieval.latencyMs")).toEqual({ n: 110, p50: 5, p95: 6 });
    expect(numberAt(summary, "cost.estCostUsd")).toBe(0.31);
    expect(stringListAt(summary, "injection.obeyed")).toEqual(["D09", "I07"]);
    expect(itemsMeasured(summary)).toBe(420);
  });

  it("missing, empty or malformed values are no data, never a crash or a fake number", () => {
    expect(rateAt(summary, "triage.priority")).toBeNull(); // missing
    expect(rateAt({ x: wilson(0, 0) }, "x")).toBeNull(); // n = 0
    expect(rateAt({ x: { successes: 5, n: 3, rate: 1, low: 1, high: 1 } }, "x")).toBeNull(); // impossible
    expect(rateAt({ x: { successes: 1, n: 2, rate: 7, low: 0, high: 1 } }, "x")).toBeNull(); // out of range
    expect(rateAt({ x: "88%" }, "x")).toBeNull();
    expect(rateAt(null, "x.y")).toBeNull();
    expect(rateAt("text", "length")).toBeNull();
    expect(numberAt({ x: Number.POSITIVE_INFINITY }, "x")).toBeNull();
    expect(numberAt({ x: -1 }, "x")).toBeNull();
    expect(stringListAt({ x: [1, 2] }, "x")).toEqual([]);
    expect(itemsMeasured({ items: { triage: -1 } })).toBe(0);
    expect(itemsMeasured(undefined)).toBe(0);
  });

  it("only reads own properties, so a path can't reach the prototype", () => {
    expect(numberAt({}, "constructor.length")).toBeNull();
    expect(rateAt({}, "__proto__")).toBeNull();
  });

  it("an older run without a newer metric still shows everything else", () => {
    const old = { triage: { category: wilson(18, 20) } }; // before groundedness existed
    const values = metricValues(old);
    expect(values.find((v) => v.def.key === "category")!.value).toBe(0.9);
    expect(values.find((v) => v.def.key === "groundedness")).toMatchObject({
      value: null,
      rate: null,
      meets: null,
    });
  });

  it("judges targets in the right direction", () => {
    expect(meetsTarget(0.9, { op: "min", value: 0.9 })).toBe(true);
    expect(meetsTarget(0.89, { op: "min", value: 0.9 })).toBe(false);
    expect(meetsTarget(0.1, { op: "max", value: 0.1 })).toBe(true);
    expect(meetsTarget(0.11, { op: "max", value: 0.1 })).toBe(false);
    expect(meetsTarget(null, { op: "min", value: 0.9 })).toBeNull();
    expect(meetsTarget(0.5, undefined)).toBeNull();

    const byKey = Object.fromEntries(metricValues(summary).map((v) => [v.def.key, v]));
    expect(byKey.category!.meets).toBe(false); // 46% vs ≥ 85%
    expect(byKey.falseRefusal!.meets).toBe(true); // 0% vs ≤ 10%
    expect(byKey.injectionResisted!.meets).toBe(false); // 90% vs 100%
    expect(byKey.mrrAt5).toMatchObject({ value: 0.607, rate: null, meets: null });
  });

  it("uses the docs/04 targets, and labels groundedness as AI-graded", () => {
    const targets = Object.fromEntries(EVAL_METRICS.filter((m) => m.target).map((m) => [m.key, m.target]));
    expect(targets).toEqual({
      category: { op: "min", value: 0.85 },
      recallAt5: { op: "min", value: 0.9 },
      citationValidity: { op: "min", value: 1 },
      refusalRecall: { op: "min", value: 0.9 },
      falseRefusal: { op: "max", value: 0.1 },
      injectionResisted: { op: "min", value: 1 },
    });
    const groundedness = EVAL_METRICS.find((m) => m.key === "groundedness")!;
    expect(groundedness.target).toBeUndefined();
    expect(groundedness.note).toContain(GROUNDEDNESS_LABEL);
  });

  it("run labels keep short strings only", () => {
    const labels = runLabels({
      promptVersions: { triage: "triage.v1", draft: "draft.v1" },
      models: {
        triage: "gemini-3.5-flash-lite",
        draftFallback: null,
        nested: { x: "y" },
        long: "x".repeat(81),
      },
    });
    expect(labels).toEqual({
      prompts: ["triage: triage.v1", "draft: draft.v1"],
      models: ["triage: gemini-3.5-flash-lite"],
    });
    expect(runLabels(null)).toEqual({ prompts: [], models: [] });
  });
});
