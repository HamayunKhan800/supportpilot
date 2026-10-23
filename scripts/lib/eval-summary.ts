import { readFileSync } from "node:fs";

import { TICKET_PRIORITIES } from "../../src/server/platform/db/schema";
import { DEFAULT_CATEGORIES } from "../../src/server/platform/auth/workspace-settings";
import {
  accuracy,
  type Floors,
  confusion,
  macroF1,
  spread,
  withinOneLevel,
  type MacroF1,
  type Spread,
} from "../../src/server/modules/eval/metrics";
import { wilson, type Rate } from "../../src/server/modules/eval/stats";
import type { EvalSuite } from "../../src/server/modules/eval/constants";

import type { DraftResult, InjectionResult, Metered, TriageResult } from "./ai-smoke";

/**
 * Turns a run's saved items into the report (M6 D3, docs/04 section 3). Pure: the runner,
 * the CI floor check and the M6 dashboard all read the same numbers from here.
 *
 * Technical failures (the provider gave no answer) are counted apart and left out of the
 * quality rates: a timeout says nothing about whether the model would have been right.
 * Each suite reports them as an error rate, which has its own floor.
 */

export interface RetrievalResult {
  id: string;
  /** 1-based rank of the first passage holding the answer, within the top 5; null if absent. */
  firstGoldRank: number | null;
  /** Articles of the top 5, best first, for error analysis. */
  retrieved: string[];
  retrievalMs: number;
}

export type SavedItem =
  | { suite: "retrieval"; failed: boolean; result: RetrievalResult }
  | { suite: "triage"; failed: boolean; result: TriageResult }
  | { suite: "draft"; failed: boolean; result: DraftResult }
  | { suite: "injection"; failed: boolean; result: InjectionResult };

export interface EvalSummary {
  items: Record<EvalSuite, number>;
  retrieval: {
    n: number;
    recallAt5: Rate;
    /** Mean reciprocal rank in the top 5: a score from 0 to 1, not a proportion. */
    mrrAt5: number | null;
    latencyMs: Spread;
  };
  triage: {
    n: number;
    errors: Rate;
    category: Rate;
    categoryF1: MacroF1;
    priority: Rate;
    priorityWithinOne: Rate;
    sentiment: Rate;
    language: Rate;
    /** Answers below the confidence threshold, left for an agent instead of applied. */
    needsReview: Rate;
    categoryConfusion: Record<string, Record<string, number>>;
    latencyMs: Spread;
  };
  drafts: {
    answerable: number;
    unanswerable: number;
    errors: Rate;
    /** Unanswerable questions the pipeline refused (higher is better). */
    refusalRecall: Rate;
    /** Answerable questions it refused (lower is better). */
    falseRefusal: Rate;
    /** Ready answers to answerable questions that cite the article holding the answer. */
    citesGold: Rate;
    /** Citations kept / citations the model wrote; invalid ones are stripped and counted. */
    citationValidity: Rate;
    blocked: number;
    refusedBeforeModel: number;
    truncated: number;
    byModel: Record<string, number>;
    ttftMs: Spread;
    endToEndMs: Spread;
    /**
     * Ready drafts whose every factual claim is backed by a cited passage, per the AI grader.
     * Always shown as GROUNDEDNESS_LABEL ("AI-graded, not checked against a human").
     */
    groundedness: Rate;
    /** Claim counts across graded drafts. Claims in one draft aren't independent: no interval. */
    claims: { total: number; supported: number; unbacked: number; cut: number };
    /** Ready drafts the grader gave no usable answer for (left out of groundedness). */
    graderErrors: number;
    gradedBy: Record<string, number>;
  };
  injection: {
    n: number;
    errors: Rate;
    /** Cases where the model showed no sign of obeying the attack. */
    resisted: Rate;
    obeyed: string[];
    /** Obeyed, but the pipeline blocked or flagged the answer before an agent saw it unmarked. */
    obeyedCaughtByCode: string[];
  };
  cost: {
    calls: number;
    failedCalls: number;
    inputTokens: number;
    outputTokens: number;
    /** At the paid-tier list price on the day of the run (the free tier costs $0). */
    estCostUsd: number;
    perTriageUsd: number | null;
    perDraftUsd: number | null;
    /** Grading one draft (evaluation cost only, never part of the app's cost per draft). */
    perGradeUsd: number | null;
  };
}

const ofSuite = <S extends EvalSuite>(items: readonly SavedItem[], suite: S) =>
  items.filter((i): i is Extract<SavedItem, { suite: S }> => i.suite === suite);

const errorRate = (items: readonly { failed: boolean }[]) =>
  wilson(items.filter((i) => i.failed).length, items.length);

const countBy = (values: readonly string[]) => {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
};

const perCall = (items: readonly Metered[]) => {
  const paid = items.filter((m) => m.calls > 0 && m.providerErrors.length === 0);
  return paid.length ? Math.round(paid.reduce((n, m) => n + m.estCostMicros, 0) / paid.length) / 1e6 : null;
};

export function summarizeEval(items: readonly SavedItem[]): EvalSummary {
  const retrieval = ofSuite(items, "retrieval").map((i) => i.result);

  const triageItems = ofSuite(items, "triage");
  const triage = triageItems.filter((i) => !i.failed).map((i) => i.result);
  const pairs = (field: "category" | "priority" | "sentiment" | "language") =>
    triage.flatMap((t) => {
      const expected = t.expected[field];
      return expected === undefined ? [] : [{ expected, got: t.got?.[field] ?? null }];
    });

  const draftItems = ofSuite(items, "draft");
  const drafts = draftItems.filter((i) => !i.failed).map((i) => i.result);
  const answerable = drafts.filter((d) => d.set === "answerable");
  const unanswerable = drafts.filter((d) => d.set === "unanswerable");
  const answeredReady = answerable.filter((d) => d.status === "ready");
  const kept = drafts.reduce((n, d) => n + d.citationCount, 0);
  const invalid = drafts.reduce((n, d) => n + d.invalidCitations, 0);
  const modelDrafts = drafts.filter((d) => d.modelCalled);
  const gradings = drafts.flatMap((d) => (d.grounding ? [d.grounding] : []));
  const graded = gradings.filter((g) => g.status === "graded");
  const allGradings = draftItems.flatMap((i) => (i.result.grounding ? [i.result.grounding] : []));

  const injectionItems = ofSuite(items, "injection");
  const injection = injectionItems.filter((i) => !i.failed).map((i) => i.result);
  const obeyed = injection.filter((i) => i.obeyed);

  const metered: Metered[] = [
    ...triageItems.map((i) => i.result),
    ...draftItems.map((i) => i.result),
    ...allGradings,
    ...injectionItems.map((i) => i.result),
  ];

  return {
    items: {
      retrieval: retrieval.length,
      triage: triageItems.length,
      draft: draftItems.length,
      injection: injectionItems.length,
    },
    retrieval: {
      n: retrieval.length,
      recallAt5: wilson(retrieval.filter((r) => r.firstGoldRank !== null).length, retrieval.length),
      mrrAt5: retrieval.length
        ? retrieval.reduce((n, r) => n + (r.firstGoldRank ? 1 / r.firstGoldRank : 0), 0) / retrieval.length
        : null,
      latencyMs: spread(retrieval.map((r) => r.retrievalMs)),
    },
    triage: {
      n: triageItems.length,
      errors: errorRate(triageItems),
      category: accuracy(pairs("category")),
      categoryF1: macroF1(pairs("category"), DEFAULT_CATEGORIES),
      priority: accuracy(pairs("priority")),
      priorityWithinOne: withinOneLevel(pairs("priority"), TICKET_PRIORITIES),
      sentiment: accuracy(pairs("sentiment")),
      language: accuracy(pairs("language")),
      needsReview: wilson(triage.filter((t) => t.needsReview).length, triage.length),
      categoryConfusion: confusion(pairs("category")),
      latencyMs: spread(triage.flatMap((t) => (t.latencyMs !== null ? [t.latencyMs] : []))),
    },
    drafts: {
      answerable: draftItems.filter((i) => i.result.set === "answerable").length,
      unanswerable: draftItems.filter((i) => i.result.set === "unanswerable").length,
      errors: errorRate(draftItems),
      refusalRecall: wilson(unanswerable.filter((d) => d.status === "refused").length, unanswerable.length),
      falseRefusal: wilson(answerable.filter((d) => d.status === "refused").length, answerable.length),
      citesGold: wilson(answeredReady.filter((d) => d.citesGold).length, answeredReady.length),
      citationValidity: wilson(kept, kept + invalid),
      blocked: drafts.filter((d) => d.status === "blocked").length,
      refusedBeforeModel: drafts.filter((d) => d.status === "refused" && !d.modelCalled).length,
      truncated: drafts.filter((d) => d.finishReason === "length").length,
      byModel: countBy(drafts.flatMap((d) => (d.model ? [d.model] : []))),
      ttftMs: spread(modelDrafts.flatMap((d) => (d.ttftMs !== null ? [d.ttftMs] : []))),
      endToEndMs: spread(drafts.flatMap((d) => (d.endToEndMs !== null ? [d.endToEndMs] : []))),
      groundedness: wilson(graded.filter((g) => g.grounded).length, graded.length),
      claims: {
        total: graded.reduce((n, g) => n + g.claims.length, 0),
        supported: graded.reduce((n, g) => n + g.supported, 0),
        unbacked: graded.reduce((n, g) => n + g.unbacked, 0),
        cut: graded.reduce((n, g) => n + g.cut, 0),
      },
      graderErrors: gradings.length - graded.length,
      gradedBy: countBy(graded.flatMap((g) => (g.model ? [g.model] : []))),
    },
    injection: {
      n: injectionItems.length,
      errors: errorRate(injectionItems),
      resisted: wilson(injection.length - obeyed.length, injection.length),
      obeyed: obeyed.map((i) => i.id),
      obeyedCaughtByCode: obeyed.filter((i) => i.caughtByCode).map((i) => i.id),
    },
    cost: {
      calls: metered.reduce((n, m) => n + m.calls, 0),
      failedCalls: metered.reduce((n, m) => n + m.providerErrors.length, 0),
      inputTokens: metered.reduce((n, m) => n + m.inputTokens, 0),
      outputTokens: metered.reduce((n, m) => n + m.outputTokens, 0),
      estCostUsd: Math.round(metered.reduce((n, m) => n + m.estCostMicros, 0)) / 1e6,
      perTriageUsd: perCall(triageItems.map((i) => i.result)),
      perDraftUsd: perCall(draftItems.map((i) => i.result).filter((d) => d.modelCalled)),
      perGradeUsd: perCall(allGradings),
    },
  };
}

/**
 * The numbers the regression floors check (eval/floors.json), as point estimates in 0..1.
 * A metric with no data is null, which fails any floor set on it.
 */
export function floorValues(s: EvalSummary): Record<string, number | null> {
  return {
    "retrieval.recallAt5": s.retrieval.recallAt5.rate,
    "retrieval.mrrAt5": s.retrieval.mrrAt5,
    "triage.category": s.triage.category.rate,
    "triage.categoryMacroF1": s.triage.categoryF1.macroF1,
    "triage.priority": s.triage.priority.rate,
    "triage.priorityWithinOne": s.triage.priorityWithinOne.rate,
    "triage.sentiment": s.triage.sentiment.rate,
    "triage.language": s.triage.language.rate,
    "triage.errorRate": s.triage.errors.rate,
    "drafts.refusalRecall": s.drafts.refusalRecall.rate,
    "drafts.falseRefusal": s.drafts.falseRefusal.rate,
    "drafts.citesGold": s.drafts.citesGold.rate,
    "drafts.citationValidity": s.drafts.citationValidity.rate,
    "drafts.errorRate": s.drafts.errors.rate,
    "drafts.groundedness": s.drafts.groundedness.rate,
    "injection.resisted": s.injection.resisted.rate,
    "injection.errorRate": s.injection.errors.rate,
  };
}

/** The floors for one provider from eval/floors.json ({ "mock": { "min": …, "max": … } }). */
export function loadFloors(file: string, provider: string): Floors {
  const all = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const floors = all[provider] as Floors | undefined;
  if (!floors || typeof floors !== "object")
    throw new Error(`${file} has no floors for --provider ${provider}`);
  return floors;
}
