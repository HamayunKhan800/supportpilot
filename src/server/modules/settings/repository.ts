import { and, eq, gte, sql } from "drizzle-orm";

import {
  aiUsage,
  workspaceSettings,
  type AI_USAGE_FEATURES,
  type AiUsageOutcome,
} from "@/server/platform/db/schema";
import type { Executor } from "@/server/platform/db/tx";

/**
 * Workspace AI settings and this month's usage (M5 step 5). Every query filters by
 * `workspaceId` (T1).
 */

export type SettingsRow = typeof workspaceSettings.$inferSelect;

/** The columns the AI settings page can change (never workspaceId, version or timestamps). */
export type SettingsChanges = Partial<
  Pick<
    SettingsRow,
    "aiEnabled" | "monthlyTokenBudget" | "triageConfidenceThreshold" | "retrievalMinScore" | "categories"
  >
>;

export async function findSettings(db: Executor, workspaceId: string): Promise<SettingsRow | null> {
  const [row] = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  return row ?? null;
}

/** Locks the row until the transaction ends, so concurrent saves are applied one at a time. */
export async function lockSettings(tx: Executor, workspaceId: string): Promise<SettingsRow | null> {
  const [row] = await tx
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .for("update");
  return row ?? null;
}

/** Applies `changes` only if the row is still at `version`; returns null when it isn't. */
export async function updateSettings(
  tx: Executor,
  workspaceId: string,
  version: number,
  changes: SettingsChanges,
): Promise<SettingsRow | null> {
  const [row] = await tx
    .update(workspaceSettings)
    .set({ ...changes, version: sql`${workspaceSettings.version} + 1` })
    .where(and(eq(workspaceSettings.workspaceId, workspaceId), eq(workspaceSettings.version, version)))
    .returning();
  return row ?? null;
}

export type UsageFeature = (typeof AI_USAGE_FEATURES)[number];

export interface FeatureUsage {
  feature: UsageFeature;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Paid-tier list price estimate, millionths of a US dollar. */
  costMicros: number;
  /** Calls per outcome, e.g. { ok: 12, refused: 3, timeout: 1 }. */
  outcomes: Partial<Record<AiUsageOutcome, number>>;
}

export interface MonthUsage {
  /** Start of the current month in UTC (the budget's window), ISO 8601. */
  since: string;
  features: FeatureUsage[];
}

/** Calls, tokens and estimated cost per feature since the start of this month (UTC). */
export async function usageThisMonth(db: Executor, workspaceId: string): Promise<MonthUsage> {
  const monthStart = sql`date_trunc('month', now(), 'UTC')`;
  const rows = await db
    .select({
      feature: aiUsage.feature,
      outcome: aiUsage.outcome,
      calls: sql<string>`count(*)`,
      inputTokens: sql<string>`coalesce(sum(${aiUsage.inputTokens}::bigint), 0)`,
      outputTokens: sql<string>`coalesce(sum(${aiUsage.outputTokens}::bigint), 0)`,
      costMicros: sql<string>`coalesce(sum(${aiUsage.estCostMicros}::bigint), 0)`,
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.workspaceId, workspaceId), gte(aiUsage.createdAt, monthStart)))
    .groupBy(aiUsage.feature, aiUsage.outcome);

  const byFeature = new Map<UsageFeature, FeatureUsage>();
  for (const r of rows) {
    const f = byFeature.get(r.feature) ?? {
      feature: r.feature,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
      outcomes: {},
    };
    const calls = Number(r.calls);
    f.calls += calls;
    f.inputTokens += Number(r.inputTokens);
    f.outputTokens += Number(r.outputTokens);
    f.costMicros += Number(r.costMicros);
    f.outcomes[r.outcome] = (f.outcomes[r.outcome] ?? 0) + calls;
    byFeature.set(r.feature, f);
  }
  // For the label only ("since 1 October"); the query above uses the database clock.
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  return { since, features: [...byFeature.values()] };
}
