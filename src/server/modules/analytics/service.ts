import type { EvalProvider } from "@/server/modules/eval/constants";
import * as evalRepo from "@/server/modules/eval/repository";
import { headlineRun } from "@/server/modules/eval/summary-view";
import { requireWorkspace } from "@/server/platform/auth/context";
import { getDb } from "@/server/platform/db/client";

import type { AnalyticsPeriod } from "./periods";
import * as repo from "./repository";

export type { DraftStats, FeatureCalls } from "./repository";
export type { EvalMissRow, EvalRunListing } from "@/server/modules/eval/repository";

/**
 * The analytics dashboard (FR-AN1, M6 step 5). Every member can read it (`analytics:read`,
 * docs/01 section 2.1, agents included): it holds counts and aggregates only, never ticket text
 * or customer details.
 *
 * Live usage is this workspace's own data. Evaluation runs are not workspace data: they measure
 * the product on synthetic test sets (docs/04), so every workspace sees the same results.
 */

export interface UsageAnalytics {
  days: AnalyticsPeriod;
  tickets: repo.TicketStats;
  drafts: repo.DraftStats;
  triage: repo.TriageStats;
  ai: repo.AiCallStats;
}

export async function getUsageAnalytics(headers: Headers, days: AnalyticsPeriod): Promise<UsageAnalytics> {
  const ctx = await requireWorkspace(headers, { analytics: ["read"] });
  const db = getDb().db;
  const id = ctx.workspace.id;
  const [tickets, drafts, triage, ai] = await Promise.all([
    repo.ticketStats(db, id, days),
    repo.draftStats(db, id, days),
    repo.triageStats(db, id, days),
    repo.aiCallStats(db, id, days),
  ]);
  return { days, tickets, drafts, triage, ai };
}

/** How many runs the trend shows. */
export const EVAL_TREND_RUNS = 10;

export interface EvaluationOverview {
  provider: EvalProvider;
  runCounts: Partial<Record<EvalProvider, number>>;
  /** Newest first. */
  runs: evalRepo.EvalRunListing[];
  /** What the headline run (headlineRun) got wrong; empty without runs. */
  misses: evalRepo.EvalMissRow[];
}

/**
 * Evaluation results for one provider. With no provider asked for, Gemini when it has runs
 * (the real measurement), otherwise mock.
 */
export async function getEvaluationOverview(
  headers: Headers,
  requested: EvalProvider | null,
): Promise<EvaluationOverview> {
  await requireWorkspace(headers, { analytics: ["read"] });
  const db = getDb().db;
  const runCounts = await evalRepo.countRunsByProvider(db);
  const provider = requested ?? ((runCounts.gemini ?? 0) > 0 ? "gemini" : "mock");
  const runs = await evalRepo.listRecentRuns(db, provider, EVAL_TREND_RUNS);
  const headline = headlineRun(runs)?.run;
  const misses = headline ? await evalRepo.listMisses(db, headline.id) : [];
  return { provider, runCounts, runs, misses };
}
