/**
 * Triage prompt v1 vs v2 (M6 plan D6a, decision rule fixed in step 3 before any Gemini data):
 * on the tickets both versions answered, adopt v2 only if category accuracy or exact priority
 * accuracy is higher with an exact McNemar p below 0.025 (0.05 split over the two metrics,
 * Bonferroni), and neither is lower with p below 0.025. Otherwise the app keeps v1.
 */
import { comparePaired, wilson, type PairedComparison, type Rate } from "../../src/server/modules/eval/stats";

/** Per-metric significance level: 0.05 split over the two metrics (Bonferroni). */
export const TRIAGE_COMPARE_ALPHA = 0.025;

/** The fields of a saved triage item this comparison reads. */
export interface TriageItemLike {
  suite: string;
  failed: boolean;
  result: {
    key?: unknown;
    status?: unknown;
    categoryCorrect?: unknown;
    priorityCorrect?: unknown;
  };
}

export interface TriageCorrectness {
  category: Map<string, boolean>;
  priority: Map<string, boolean>;
}

/**
 * Correctness per ticket, from the tickets the model actually answered. A provider failure or a
 * missing answer is left out (it says nothing about the prompt), so the pairing below drops it.
 */
export function triageCorrectness(items: readonly TriageItemLike[]): TriageCorrectness {
  const category = new Map<string, boolean>();
  const priority = new Map<string, boolean>();
  for (const item of items) {
    if (item.suite !== "triage" || item.failed) continue;
    const r = item.result;
    if (r.status !== "succeeded" || typeof r.key !== "string") continue;
    if (typeof r.categoryCorrect !== "boolean" || typeof r.priorityCorrect !== "boolean") continue;
    if (category.has(r.key)) throw new Error(`Ticket ${r.key} appears twice in one run.`);
    category.set(r.key, r.categoryCorrect);
    priority.set(r.key, r.priorityCorrect);
  }
  return { category, priority };
}

export interface MetricComparison extends PairedComparison {
  /** Each version's rate on the paired tickets, with its 95% Wilson interval. */
  v1: Rate;
  v2: Rate;
  /** v2 right more often than v1 on the tickets they disagree on, and p below the level. */
  v2Better: boolean;
  v2Worse: boolean;
}

export type TriageVerdict = "adopt-v2" | "keep-v1-no-difference" | "keep-v1-v2-worse";

export interface TriagePromptDecision {
  category: MetricComparison;
  priority: MetricComparison;
  verdict: TriageVerdict;
  alpha: number;
}

function metric(v1: ReadonlyMap<string, boolean>, v2: ReadonlyMap<string, boolean>, alpha: number) {
  const c = comparePaired(v1, v2);
  return {
    ...c,
    v1: wilson(c.bothRight + c.onlyA, c.n),
    v2: wilson(c.bothRight + c.onlyB, c.n),
    v2Better: c.onlyB > c.onlyA && c.pValue < alpha,
    v2Worse: c.onlyA > c.onlyB && c.pValue < alpha,
  };
}

export function decideTriagePrompt(
  v1: TriageCorrectness,
  v2: TriageCorrectness,
  alpha = TRIAGE_COMPARE_ALPHA,
): TriagePromptDecision {
  const category = metric(v1.category, v2.category, alpha);
  const priority = metric(v1.priority, v2.priority, alpha);
  const worse = category.v2Worse || priority.v2Worse;
  const better = category.v2Better || priority.v2Better;
  const verdict: TriageVerdict = worse ? "keep-v1-v2-worse" : better ? "adopt-v2" : "keep-v1-no-difference";
  return { category, priority, verdict, alpha };
}
