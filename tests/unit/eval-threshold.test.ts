import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEFAULT_RETRIEVAL_MIN_SCORE } from "@/server/modules/kb/retrieval";

import {
  chooseThreshold,
  gateRefuses,
  summarizeScores,
  sweep,
  type ScoredQuestion,
} from "../../scripts/lib/threshold";

const a = (id: string, topScore: number | null): ScoredQuestion => ({ id, set: "answerable", topScore });
const u = (id: string, topScore: number | null): ScoredQuestion => ({ id, set: "unanswerable", topScore });

describe("gateRefuses (the draft pipeline's test)", () => {
  it("refuses below the threshold or with no score, and lets the threshold itself through", () => {
    expect(gateRefuses(0.61, 0.62)).toBe(true);
    expect(gateRefuses(0.62, 0.62)).toBe(false);
    expect(gateRefuses(null, 0)).toBe(true);
  });
});

describe("sweep", () => {
  it("rounds thresholds to two decimals and counts both kinds of refusal", () => {
    const rows = sweep([a("q1", 0.7), a("q2", 0.64), u("u1", 0.59), u("u2", 0.75)], 0.6, 0.65, 0.01);
    expect(rows.map((r) => r.threshold)).toEqual([0.6, 0.61, 0.62, 0.63, 0.64, 0.65]);
    const at65 = rows.at(-1)!;
    expect(at65.falseRefusal).toMatchObject({ successes: 1, n: 2 });
    expect(at65.refusalRecall).toMatchObject({ successes: 1, n: 2 });
  });
});

describe("chooseThreshold", () => {
  // The shape of the real data (finding #105): two off-topic questions far below the rest,
  // then answerable and near-miss unanswerable questions mixed together.
  const scores = [
    u("weather", 0.57),
    u("laptop", 0.593),
    a("q002", 0.638),
    a("q027", 0.652),
    ...Array.from({ length: 98 }, (_, i) => a(`a${i}`, 0.7 + i * 0.001)),
  ];
  const rows = sweep(scores, 0.55, 0.7, 0.01);

  it("does not take the highest allowed threshold when a lower one catches as many and wrongly refuses fewer", () => {
    // 0.66 is allowed (2 of 100 answerable = 2%) but catches nothing more than 0.60.
    expect(rows.find((r) => r.threshold === 0.66)!.refusalRecall.successes).toBe(2);
    expect(rows.find((r) => r.threshold === 0.66)!.falseRefusal.successes).toBe(2);
    const chosen = chooseThreshold(rows)!;
    expect(chosen.refusalRecall.successes).toBe(2);
    expect(chosen.falseRefusal.successes).toBe(0);
  });

  it("takes the middle of the tied range, rounded up, for a margin on both sides", () => {
    // 0.60, 0.61, 0.62 and 0.63 all catch 2 and refuse no answerable question.
    expect(chooseThreshold(rows)!.threshold).toBe(0.62);
  });

  it("prefers catching more unanswerable questions while staying within the limit", () => {
    // A third unanswerable question at 0.645 is caught from 0.65, which also refuses q002
    // (1 of 100): allowed, and it catches more, so it wins. 0.66 would refuse q027 too.
    const more = sweep([...scores, u("near-miss", 0.645)], 0.55, 0.7, 0.01);
    const chosen = chooseThreshold(more)!;
    expect(chosen.threshold).toBe(0.65);
    expect(chosen.refusalRecall.successes).toBe(3);
    expect(chosen.falseRefusal.successes).toBe(1);
  });

  it("returns null when every threshold wrongly refuses too many", () => {
    expect(chooseThreshold(sweep([a("q", 0.5), u("u", 0.9)], 0.6, 0.6, 0.01))).toBeNull();
  });
});

describe("summarizeScores", () => {
  it("gives the spread with nearest-rank percentiles and skips missing scores", () => {
    expect(summarizeScores([0.5, null, 0.9, 0.7])).toEqual({
      n: 3,
      min: 0.5,
      p10: 0.5,
      median: 0.7,
      p90: 0.9,
      max: 0.9,
    });
    expect(summarizeScores([]).n).toBe(0);
  });
});

describe("the committed analysis", () => {
  it("chose the default the code uses, from 110 answerable and 30 unanswerable questions", () => {
    const report = JSON.parse(readFileSync("eval/results/threshold-gemini.json", "utf8")) as {
      model: string;
      chosen: { threshold: number };
      scores: ScoredQuestion[];
    };
    expect(report.model).toBe("gemini-embedding-2@768");
    expect(report.scores.filter((s) => s.set === "answerable")).toHaveLength(110);
    expect(report.scores.filter((s) => s.set === "unanswerable")).toHaveLength(30);
    expect(report.chosen.threshold).toBe(DEFAULT_RETRIEVAL_MIN_SCORE);
    // Re-applying the rule to the saved scores gives the same answer.
    expect(chooseThreshold(sweep(report.scores))!.threshold).toBe(DEFAULT_RETRIEVAL_MIN_SCORE);
  });
});
