import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  aiDailyCalls,
  aiUsage,
  workspaceSettings,
  type AI_USAGE_FEATURES,
  type AiUsageOutcome,
} from "@/server/platform/db/schema";
import type { Executor } from "@/server/platform/db/tx";
import { BUDGET_FEATURES } from "./config";

/**
 * AI usage ledger: the budget check, the shared daily call cap and the per-call usage record
 * (M5 D12, D14). Every per-workspace query filters by `workspaceId` (T1).
 */

export type AiUsageFeature = (typeof AI_USAGE_FEATURES)[number];

export interface AiUsageRecord {
  feature: AiUsageFeature;
  model: string;
  inputTokens: number;
  outputTokens?: number;
  estCostMicros: number;
  outcome?: AiUsageOutcome;
  latencyMs?: number | null;
  ttftMs?: number | null;
  ticketId?: string | null;
}

export async function insertAiUsageRecord(
  db: Executor,
  workspaceId: string,
  row: AiUsageRecord,
): Promise<void> {
  await db.insert(aiUsage).values({
    workspaceId,
    feature: row.feature,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens ?? 0,
    estCostMicros: row.estCostMicros,
    outcome: row.outcome ?? "ok",
    latencyMs: row.latencyMs ?? null,
    ttftMs: row.ttftMs ?? null,
    ticketId: row.ticketId ?? null,
  });
}

export interface AiPolicy {
  aiEnabled: boolean;
  monthlyTokenBudget: number;
  /** Input + output tokens of triage and draft calls since the start of this month (UTC). */
  tokensUsedThisMonth: number;
}

/**
 * The workspace's AI switch and budget, plus what it has used this month. Returns null when the
 * workspace has no settings row, and callers treat that as "AI off" (fail closed).
 *
 * The budget counts text generation only. Embeddings cost about a hundredth as much per token
 * and are bounded by upload limits; they get their own daily budget in M8.
 */
export async function getAiPolicy(db: Executor, workspaceId: string): Promise<AiPolicy | null> {
  const [settings] = await db
    .select({
      aiEnabled: workspaceSettings.aiEnabled,
      monthlyTokenBudget: workspaceSettings.monthlyTokenBudget,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  if (!settings) return null;
  const [used] = await db
    .select({
      tokens: sql<string>`coalesce(sum(${aiUsage.inputTokens}::bigint + ${aiUsage.outputTokens}), 0)`,
    })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.workspaceId, workspaceId),
        inArray(aiUsage.feature, [...BUDGET_FEATURES]),
        gte(aiUsage.createdAt, sql`date_trunc('month', now(), 'UTC')`),
      ),
    );
  return { ...settings, tokensUsedThisMonth: Number(used?.tokens ?? 0) };
}

/**
 * Reserves `units` (default one call) against a deployment-wide daily cap with a single atomic
 * upsert, so concurrent web and worker processes can never overshoot it. Returns false, and
 * reserves nothing, when the units don't fit. The day is the calendar date in
 * America/Los_Angeles, matching Google's quota reset.
 */
export async function reserveDailyCall(
  db: Executor,
  scope: string,
  limit: number,
  units = 1,
): Promise<boolean> {
  if (!Number.isInteger(units) || units < 1) throw new Error("units must be a positive integer");
  if (limit <= 0 || units > limit) return false;
  const rows = await db
    .insert(aiDailyCalls)
    .values({ day: sql`(now() AT TIME ZONE 'America/Los_Angeles')::date`, scope, calls: units })
    .onConflictDoUpdate({
      target: [aiDailyCalls.day, aiDailyCalls.scope],
      set: { calls: sql`${aiDailyCalls.calls} + ${units}` },
      setWhere: sql`${aiDailyCalls.calls} + ${units} <= ${limit}`,
    })
    .returning({ calls: aiDailyCalls.calls });
  return rows.length === 1;
}

/** Calls made today (Pacific date) in a scope, for the settings page and tests. */
export async function dailyCallsToday(db: Executor, scope: string): Promise<number> {
  const [row] = await db
    .select({ calls: aiDailyCalls.calls })
    .from(aiDailyCalls)
    .where(
      and(
        eq(aiDailyCalls.scope, scope),
        eq(aiDailyCalls.day, sql`(now() AT TIME ZONE 'America/Los_Angeles')::date`),
      ),
    );
  return row?.calls ?? 0;
}
