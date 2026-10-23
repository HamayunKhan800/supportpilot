import { wilson, type Rate } from "../../src/server/modules/eval/stats";

/**
 * Choosing `retrieval_min_score` (M6 D6b, docs/04 section 4). The draft pipeline refuses
 * without calling the model when the best vector similarity is below this score (D7). This
 * module sweeps candidate thresholds over measured scores and applies a rule fixed before the
 * scores were looked at.
 *
 * The rule: the gate may refuse at most 2% of answerable questions. Among the thresholds that
 * meet that: (1) catch the most unanswerable questions; (2) on a tie, wrongly refuse the
 * fewest answerable ones; (3) still tied, take the middle of the tied range (rounded up), for a
 * margin on both sides. Tie-breaks 2 and 3 were added after the first run (finding #105): the
 * first rule said only "the highest threshold", which picked 0.66, refusing the same two
 * unanswerable questions as 0.60 while refusing two answerable ones.
 * Why 2%, not the 10% target: a question the gate refuses never reaches the model, so the
 * mistake cannot be undone, while an unanswerable question the gate lets through can still
 * be refused by the model (it says INSUFFICIENT_KNOWLEDGE). Most of the 10% false-refusal
 * budget is left to the model.
 */

export const GATE_MAX_FALSE_REFUSAL = 0.02;

export interface ScoredQuestion {
  id: string;
  set: "answerable" | "unanswerable";
  /** Best vector similarity among the passages found; null when nothing was found. */
  topScore: number | null;
}

export interface SweepRow {
  threshold: number;
  /** Answerable questions the gate would refuse (lower is better). */
  falseRefusal: Rate;
  /** Unanswerable questions the gate would refuse (higher is better). */
  refusalRecall: Rate;
}

/** The pipeline's own test: refused when there is no score or it is below the threshold. */
export const gateRefuses = (topScore: number | null, threshold: number) =>
  topScore === null || topScore < threshold;

/** Thresholds from `from` to `to` in steps of `step`, rounded to 2 decimals (no float drift). */
export function sweep(scores: readonly ScoredQuestion[], from = 0.4, to = 0.9, step = 0.01): SweepRow[] {
  const answerable = scores.filter((s) => s.set === "answerable");
  const unanswerable = scores.filter((s) => s.set === "unanswerable");
  const rows: SweepRow[] = [];
  const steps = Math.round((to - from) / step);
  for (let i = 0; i <= steps; i++) {
    const threshold = Math.round((from + i * step) * 100) / 100;
    rows.push({
      threshold,
      falseRefusal: wilson(
        answerable.filter((s) => gateRefuses(s.topScore, threshold)).length,
        answerable.length,
      ),
      refusalRecall: wilson(
        unanswerable.filter((s) => gateRefuses(s.topScore, threshold)).length,
        unanswerable.length,
      ),
    });
  }
  return rows;
}

/** Applies the rule above to a sweep; null when no threshold keeps false refusals within the limit. */
export function chooseThreshold(
  rows: readonly SweepRow[],
  maxFalseRefusal = GATE_MAX_FALSE_REFUSAL,
): SweepRow | null {
  const ok = rows.filter((r) => r.falseRefusal.rate !== null && r.falseRefusal.rate <= maxFalseRefusal);
  if (ok.length === 0) return null;
  const mostCaught = Math.max(...ok.map((r) => r.refusalRecall.successes));
  const caught = ok.filter((r) => r.refusalRecall.successes === mostCaught);
  const fewestWrong = Math.min(...caught.map((r) => r.falseRefusal.successes));
  const tied = caught
    .filter((r) => r.falseRefusal.successes === fewestWrong)
    .sort((a, b) => a.threshold - b.threshold);
  return tied[Math.floor(tied.length / 2)]!;
}

export interface ScoreSummary {
  n: number;
  min: number | null;
  p10: number | null;
  median: number | null;
  p90: number | null;
  max: number | null;
}

const nearestRank = (sorted: number[], p: number) =>
  sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;

/** Spread of the best scores of one group, for the report. */
export function summarizeScores(values: readonly (number | null)[]): ScoreSummary {
  const sorted = values.flatMap((v) => (v === null ? [] : [v])).sort((a, b) => a - b);
  if (sorted.length === 0) return { n: 0, min: null, p10: null, median: null, p90: null, max: null };
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return {
    n: sorted.length,
    min: r(sorted[0]!),
    p10: r(nearestRank(sorted, 10)),
    median: r(nearestRank(sorted, 50)),
    p90: r(nearestRank(sorted, 90)),
    max: r(sorted.at(-1)!),
  };
}
