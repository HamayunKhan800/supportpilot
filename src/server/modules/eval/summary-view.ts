import { z } from "zod";

import { GROUNDEDNESS_LABEL } from "./grader";
import type { Rate } from "./stats";

/**
 * Reads stored evaluation summaries for the dashboard (M6 step 5). `eval_run.summary` is JSON
 * written by whichever version of `pnpm eval` ran, so it is treated as untrusted input: every
 * number is validated where it is read, and anything missing or malformed shows as "no data"
 * instead of failing the page. Runs from before a metric existed (groundedness arrived in
 * step 3) still display everything else.
 */

const unit = z.number().min(0).max(1);
const count = z.number().int().min(0);

const RateSchema = z
  .object({ successes: count, n: count, rate: unit.nullable(), low: unit.nullable(), high: unit.nullable() })
  .refine((r) => r.successes <= r.n && (r.n === 0) === (r.rate === null), "inconsistent rate");

const SpreadSchema = z.object({
  n: count,
  p50: z.number().min(0).nullable(),
  p95: z.number().min(0).nullable(),
});

export interface SpreadView {
  n: number;
  p50: number | null;
  p95: number | null;
}

function at(summary: unknown, path: string): unknown {
  let value: unknown = summary;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function rateAt(summary: unknown, path: string): Rate | null {
  const parsed = RateSchema.safeParse(at(summary, path));
  return parsed.success && parsed.data.n > 0 ? parsed.data : null;
}

export function spreadAt(summary: unknown, path: string): SpreadView | null {
  const parsed = SpreadSchema.safeParse(at(summary, path));
  return parsed.success && parsed.data.n > 0 ? parsed.data : null;
}

/** A plain number at `path` (scores such as MRR or macro-F1, costs, counts), or null. */
export function numberAt(
  summary: unknown,
  path: string,
  schema: z.ZodType<number> = z.number().min(0),
): number | null {
  const parsed = schema.safeParse(at(summary, path));
  return parsed.success && Number.isFinite(parsed.data) ? parsed.data : null;
}

export function stringListAt(summary: unknown, path: string): string[] {
  const parsed = z.array(z.string().max(80)).max(500).safeParse(at(summary, path));
  return parsed.success ? parsed.data : [];
}

// --- What the dashboard shows ---------------------------------------------------------------

export type MetricGroup = "Triage" | "Knowledge search" | "Drafts" | "Safety";

export interface Target {
  /** `min`: the rate should be at least `value`; `max`: at most `value`. */
  op: "min" | "max";
  value: number;
}

export interface MetricDef {
  key: string;
  label: string;
  group: MetricGroup;
  /** Where the number sits in the stored summary. */
  path: string;
  /** `rate`: a proportion with a 95% Wilson interval; `score`: a 0–1 score with no interval. */
  kind: "rate" | "score";
  /** The docs/04 target (a hypothesis to test, not a promise). None = reported only. */
  target?: Target;
  /** Shown under the number; required wherever the reading could mislead. */
  note?: string;
  /** Shown in the trend table and chart. */
  headline?: boolean;
}

/** Targets from docs/04-ai-evaluation-plan.md section 3. */
export const EVAL_METRICS: readonly MetricDef[] = [
  {
    key: "category",
    label: "Category accuracy",
    group: "Triage",
    path: "triage.category",
    kind: "rate",
    target: { op: "min", value: 0.85 },
    headline: true,
  },
  {
    key: "categoryF1",
    label: "Category macro-F1",
    group: "Triage",
    path: "triage.categoryF1.macroF1",
    kind: "score",
  },
  {
    key: "priority",
    label: "Priority, exact",
    group: "Triage",
    path: "triage.priority",
    kind: "rate",
    headline: true,
  },
  {
    key: "priorityWithinOne",
    label: "Priority, within one level",
    group: "Triage",
    path: "triage.priorityWithinOne",
    kind: "rate",
  },
  { key: "sentiment", label: "Sentiment", group: "Triage", path: "triage.sentiment", kind: "rate" },
  { key: "language", label: "Language", group: "Triage", path: "triage.language", kind: "rate" },
  {
    key: "recallAt5",
    label: "Recall@5",
    group: "Knowledge search",
    path: "retrieval.recallAt5",
    kind: "rate",
    target: { op: "min", value: 0.9 },
    note: "The article holding the answer is among the top 5 results.",
    headline: true,
  },
  {
    key: "mrrAt5",
    label: "MRR@5",
    group: "Knowledge search",
    path: "retrieval.mrrAt5",
    kind: "score",
    note: "1 = the right article always comes first.",
  },
  {
    key: "citationValidity",
    label: "Citation validity",
    group: "Drafts",
    path: "drafts.citationValidity",
    kind: "rate",
    target: { op: "min", value: 1 },
    note: "Citations pointing at a retrieved passage. Invalid ones are removed before an agent sees the draft.",
  },
  {
    key: "citesGold",
    label: "Cites the right article",
    group: "Drafts",
    path: "drafts.citesGold",
    kind: "rate",
  },
  {
    key: "refusalRecall",
    label: "Refuses when it should",
    group: "Drafts",
    path: "drafts.refusalRecall",
    kind: "rate",
    target: { op: "min", value: 0.9 },
    note: "Questions the knowledge base can't answer, refused instead of guessed.",
    headline: true,
  },
  {
    key: "falseRefusal",
    label: "Refuses when it shouldn't",
    group: "Drafts",
    path: "drafts.falseRefusal",
    kind: "rate",
    target: { op: "max", value: 0.1 },
    note: "Lower is better.",
  },
  {
    key: "groundedness",
    label: "Groundedness",
    group: "Drafts",
    path: "drafts.groundedness",
    kind: "rate",
    note: `${GROUNDEDNESS_LABEL}.`,
  },
  {
    key: "injectionResisted",
    label: "Prompt-injection resistance",
    group: "Safety",
    path: "injection.resisted",
    kind: "rate",
    target: { op: "min", value: 1 },
    headline: true,
  },
];

export const METRIC_GROUPS: readonly MetricGroup[] = ["Triage", "Knowledge search", "Drafts", "Safety"];

/** Whether a measured value meets its target; null when there is no target or no data. */
export function meetsTarget(value: number | null, target: Target | undefined): boolean | null {
  if (!target || value === null) return null;
  return target.op === "min" ? value >= target.value : value <= target.value;
}

export interface MetricValue {
  def: MetricDef;
  /** The point estimate (0–1), or null when the run has no data for it. */
  value: number | null;
  rate: Rate | null;
  meets: boolean | null;
}

export function metricValues(summary: unknown): MetricValue[] {
  return EVAL_METRICS.map((def) => {
    const rate = def.kind === "rate" ? rateAt(summary, def.path) : null;
    const value = def.kind === "rate" ? (rate?.rate ?? null) : numberAt(summary, def.path, unit);
    return { def, value, rate, meets: meetsTarget(value, def.target) };
  });
}

/** Total items measured in a run, from the stored per-suite counts. */
export function itemsMeasured(summary: unknown): number {
  const parsed = z.record(z.string(), count).safeParse(at(summary, "items"));
  return parsed.success ? Object.values(parsed.data).reduce((n, v) => n + v, 0) : 0;
}

/** The models and prompt versions a run used, read from its stored settings (strings only). */
export function runLabels(config: unknown): { prompts: string[]; models: string[] } {
  const strings = (v: unknown) =>
    v !== null && typeof v === "object"
      ? Object.entries(v as Record<string, unknown>).flatMap(([k, s]) =>
          typeof s === "string" && s.length <= 80 ? [`${k}: ${s}`] : [],
        )
      : [];
  return { prompts: strings(at(config, "promptVersions")), models: strings(at(config, "models")) };
}

/**
 * The run the dashboard leads with: the newest complete run, so a newer partial run (one still
 * in progress, or a triage-only comparison such as M6's prompt v2 run) doesn't replace full
 * results; the newest run when none is complete. `newer` is the newest run when it isn't the
 * one shown, so the page can say it exists. All runs still appear in the trend.
 */
export function headlineRun<T extends { status: string }>(
  runs: readonly T[],
): { run: T; newer: T | null } | null {
  const run = runs.find((r) => r.status === "completed") ?? runs[0];
  if (!run) return null;
  return { run, newer: run === runs[0] ? null : runs[0]! };
}

// --- Comparing two runs (after Braintrust's experiment comparison) ---------------------------

/**
 * `better` / `worse` only when the two 95% ranges don't overlap, a deliberately cautious rule
 * (the item-level paired test in docs/eval/triage-v1-v2.md is the precise one); `unclear` when
 * they overlap or the metric has no range (scores), so the move could be chance.
 */
export type ChangeVerdict = "better" | "worse" | "unclear" | "same";

export interface MetricChange {
  def: MetricDef;
  before: number;
  after: number;
  /** after − before, on the 0–1 scale. */
  delta: number;
  verdict: ChangeVerdict;
}

/** The metrics both runs measured, with the change from `older` to `newer` and its verdict. */
export function compareRuns(newer: unknown, older: unknown): MetricChange[] {
  const before = metricValues(older);
  return metricValues(newer).flatMap((a) => {
    const b = before.find((v) => v.def.key === a.def.key);
    if (!b || a.value === null || b.value === null) return [];
    const delta = a.value - b.value;
    const lowerIsBetter = a.def.target?.op === "max";
    const apart =
      a.rate !== null &&
      b.rate !== null &&
      a.rate.low !== null &&
      a.rate.high !== null &&
      b.rate.low !== null &&
      b.rate.high !== null &&
      (a.rate.low > b.rate.high || a.rate.high < b.rate.low);
    const verdict: ChangeVerdict =
      Math.abs(delta) < 1e-9 ? "same" : !apart ? "unclear" : delta > 0 !== lowerIsBetter ? "better" : "worse";
    return [{ def: a.def, before: b.value, after: a.value, delta, verdict }];
  });
}

/** Prompt versions and models that differ between two runs' settings, e.g. "triage prompt: triage.v1 → triage.v2". */
export function settingsChanges(newerConfig: unknown, olderConfig: unknown): string[] {
  const read = (config: unknown, path: string): Record<string, string> => {
    const v = at(config, path);
    if (v === null || typeof v !== "object") return {};
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === "string" && e[1].length <= 80 && e[0].length <= 40,
      ),
    );
  };
  return (
    [
      ["promptVersions", "prompt"],
      ["models", "model"],
    ] as const
  ).flatMap(([path, noun]) => {
    const a = read(newerConfig, path);
    const b = read(olderConfig, path);
    return [...new Set([...Object.keys(b), ...Object.keys(a)])]
      .sort()
      .filter((k) => a[k] !== b[k])
      .map((k) => `${k} ${noun}: ${b[k] ?? "none"} → ${a[k] ?? "none"}`);
  });
}
