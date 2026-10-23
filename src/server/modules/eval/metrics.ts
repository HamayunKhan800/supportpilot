import { percentile } from "./retrieval-metrics";
import { wilson, type Rate } from "./stats";

/**
 * The evaluation's metrics (docs/04 section 3, M6 D3): pure functions over per-item results,
 * so the runner, the CI floor check and the dashboard compute every number the same way.
 * Every proportion is a Rate with its 95% Wilson interval (stats.ts); scores that are not
 * proportions (macro-F1, MRR) are plain numbers and say so.
 */

/** Share of items where `got` equals `expected`. Items with no answer (`got` null) count as wrong. */
export function accuracy(pairs: readonly { expected: string; got: string | null }[]): Rate {
  return wilson(pairs.filter((p) => p.got === p.expected).length, pairs.length);
}

/**
 * Priority within one level: "high" for an "urgent" ticket is a near miss, "low" for an
 * "urgent" one is not. `order` lists the levels from lowest to highest.
 */
export function withinOneLevel(
  pairs: readonly { expected: string; got: string | null }[],
  order: readonly string[],
): Rate {
  const level = (v: string) => {
    const i = order.indexOf(v);
    if (i === -1) throw new RangeError(`Unknown level "${v}" (expected one of ${order.join(", ")})`);
    return i;
  };
  const near = pairs.filter((p) => p.got !== null && Math.abs(level(p.got) - level(p.expected)) <= 1);
  return wilson(near.length, pairs.length);
}

export interface LabelScore {
  label: string;
  /** Items whose expected label is this one. */
  support: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface MacroF1 {
  /** Unweighted mean of the per-label F1 scores (labels with support > 0). Not a proportion: no interval. */
  macroF1: number | null;
  perLabel: LabelScore[];
}

/**
 * Macro-F1 over `labels`: F1 per label, then the plain mean, so a rare category counts as
 * much as a common one. A label the model never predicted has precision null and F1 0 when
 * it has support. Labels with no support are listed but left out of the mean.
 */
export function macroF1(
  pairs: readonly { expected: string; got: string | null }[],
  labels: readonly string[],
): MacroF1 {
  const perLabel = labels.map((label): LabelScore => {
    const tp = pairs.filter((p) => p.expected === label && p.got === label).length;
    const predicted = pairs.filter((p) => p.got === label).length;
    const support = pairs.filter((p) => p.expected === label).length;
    const precision = predicted ? tp / predicted : null;
    const recall = support ? tp / support : null;
    const f1 = support === 0 ? null : tp === 0 ? 0 : (2 * precision! * recall!) / (precision! + recall!);
    return { label, support, precision, recall, f1 };
  });
  const scored = perLabel.flatMap((l) => (l.f1 === null ? [] : [l.f1]));
  return {
    macroF1: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null,
    perLabel,
  };
}

/** confusion[expected][got] = count; "(none)" when the model gave no answer. */
export function confusion(
  pairs: readonly { expected: string; got: string | null }[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const p of pairs) {
    const row = (out[p.expected] ??= {});
    const got = p.got ?? "(none)";
    row[got] = (row[got] ?? 0) + 1;
  }
  return out;
}

export interface Spread {
  n: number;
  p50: number | null;
  p95: number | null;
}

/** Nearest-rank p50 and p95, rounded to whole milliseconds. */
export function spread(values: readonly number[]): Spread {
  if (values.length === 0) return { n: 0, p50: null, p95: null };
  return {
    n: values.length,
    p50: Math.round(percentile(values, 50)),
    p95: Math.round(percentile(values, 95)),
  };
}

// --- Floors (M6 D4) -----------------------------------------------------------------------

/**
 * Regression floors: `min` for "higher is better" metrics, `max` for "lower is better" ones
 * (false refusals, injections obeyed). Values are point estimates in 0..1.
 */
export interface Floors {
  min?: Record<string, number>;
  max?: Record<string, number>;
}

export interface FloorFailure {
  metric: string;
  kind: "min" | "max";
  limit: number;
  /** null when the run measured nothing for this metric, which also fails. */
  actual: number | null;
}

/** Every floor the run misses; an empty list means the run passes. */
export function checkFloors(values: Readonly<Record<string, number | null>>, floors: Floors): FloorFailure[] {
  const failures: FloorFailure[] = [];
  for (const [kind, limits] of [
    ["min", floors.min ?? {}],
    ["max", floors.max ?? {}],
  ] as const) {
    for (const [metric, limit] of Object.entries(limits)) {
      const actual = values[metric] ?? null;
      const ok = actual !== null && (kind === "min" ? actual >= limit : actual <= limit);
      if (!ok) failures.push({ metric, kind, limit, actual });
    }
  }
  return failures;
}
