import { and, eq, gte, inArray, sql, type SQL } from "drizzle-orm";

import {
  aiDraft,
  aiUsage,
  REPORTED_USAGE_FEATURES,
  ticket,
  ticketTriage,
  type AiUsageOutcome,
} from "@/server/platform/db/schema";
import type { Executor } from "@/server/platform/db/tx";

/**
 * Live usage numbers for the analytics dashboard (FR-AN1). Every query filters by `workspaceId`
 * (T1) and returns counts and aggregates only: no ticket text, names or email addresses leave
 * this file. Days are UTC calendar days; a window of N days starts at midnight UTC N - 1 days ago.
 *
 * Percentiles use `percentile_disc`, the nearest-rank method, the same one the evaluation
 * reports use (src/server/modules/eval/metrics.ts), so live and test latencies are comparable.
 */

type UsageFeature = (typeof REPORTED_USAGE_FEATURES)[number];

/** Midnight UTC at the start of the window. */
const windowStart = (days: number): SQL =>
  sql`(date_trunc('day', now(), 'UTC') - make_interval(days => ${days - 1}))`;

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface DailyCount {
  /** YYYY-MM-DD (UTC). */
  day: string;
  count: number;
}

export interface TicketStats {
  created: number;
  daily: DailyCount[];
  /** Current status of the tickets created in the window. */
  byStatus: Record<string, number>;
  /** Current category; null = not categorised yet. */
  byCategory: { category: string | null; count: number }[];
}

export async function ticketStats(db: Executor, workspaceId: string, days: number): Promise<TicketStats> {
  const from = windowStart(days);
  const daily = await db.execute<{ day: string; count: string }>(sql`
    WITH d AS (
      SELECT generate_series(${from}, date_trunc('day', now(), 'UTC'), interval '1 day') AS day
    )
    SELECT to_char(d.day AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(t.id) AS count
    FROM d
    LEFT JOIN ${ticket} t
      ON t.workspace_id = ${workspaceId} AND t.created_at >= d.day AND t.created_at < d.day + interval '1 day'
    GROUP BY d.day
    ORDER BY d.day
  `);
  const inWindow = and(eq(ticket.workspaceId, workspaceId), gte(ticket.createdAt, from));
  const [statusRows, categoryRows] = await Promise.all([
    db
      .select({ status: ticket.status, count: sql<string>`count(*)` })
      .from(ticket)
      .where(inWindow)
      .groupBy(ticket.status),
    db
      .select({ category: ticket.category, count: sql<string>`count(*)` })
      .from(ticket)
      .where(inWindow)
      .groupBy(ticket.category)
      .orderBy(sql`count(*) DESC`, ticket.category),
  ]);
  const dailyCounts = daily.rows.map((r) => ({ day: r.day, count: num(r.count) }));
  return {
    created: dailyCounts.reduce((n, d) => n + d.count, 0),
    daily: dailyCounts,
    byStatus: Object.fromEntries(statusRows.map((r) => [r.status, num(r.count)])),
    byCategory: categoryRows.map((r) => ({ category: r.category, count: num(r.count) })),
  };
}

export interface DraftStats {
  /** Drafts created in the window, per status. */
  byStatus: Record<string, number>;
  /** Sent drafts with an edit ratio (0 = sent unchanged, 1 = rewritten). */
  edited: { n: number; mean: number | null; median: number | null };
  feedback: { up: number; down: number };
}

export async function draftStats(db: Executor, workspaceId: string, days: number): Promise<DraftStats> {
  const inWindow = and(eq(aiDraft.workspaceId, workspaceId), gte(aiDraft.createdAt, windowStart(days)));
  const [statusRows, [agg]] = await Promise.all([
    db
      .select({ status: aiDraft.status, count: sql<string>`count(*)` })
      .from(aiDraft)
      .where(inWindow)
      .groupBy(aiDraft.status),
    db
      .select({
        edited: sql<string>`count(${aiDraft.editRatio}) FILTER (WHERE ${aiDraft.status} = 'sent')`,
        mean: sql<string | null>`avg(${aiDraft.editRatio}) FILTER (WHERE ${aiDraft.status} = 'sent')`,
        median: sql<
          string | null
        >`percentile_disc(0.5) WITHIN GROUP (ORDER BY ${aiDraft.editRatio}) FILTER (WHERE ${aiDraft.status} = 'sent')`,
        up: sql<string>`count(*) FILTER (WHERE ${aiDraft.feedback} = 'up')`,
        down: sql<string>`count(*) FILTER (WHERE ${aiDraft.feedback} = 'down')`,
      })
      .from(aiDraft)
      .where(inWindow),
  ]);
  return {
    byStatus: Object.fromEntries(statusRows.map((r) => [r.status, num(r.count)])),
    edited: { n: num(agg?.edited), mean: numOrNull(agg?.mean), median: numOrNull(agg?.median) },
    feedback: { up: num(agg?.up), down: num(agg?.down) },
  };
}

export interface TriageStats {
  succeeded: number;
  failed: number;
  skipped: number;
  /** Successful runs where an agent chose a different category or priority. */
  overridden: number;
  categoryOverridden: number;
  priorityOverridden: number;
  /** Successful runs that applied at least one label automatically. */
  autoApplied: number;
  needsReview: number;
}

export async function triageStats(db: Executor, workspaceId: string, days: number): Promise<TriageStats> {
  const ok = sql`${ticketTriage.status} = 'succeeded'`;
  const [row] = await db
    .select({
      succeeded: sql<string>`count(*) FILTER (WHERE ${ok})`,
      failed: sql<string>`count(*) FILTER (WHERE ${ticketTriage.status} = 'failed')`,
      skipped: sql<string>`count(*) FILTER (WHERE ${ticketTriage.status} = 'skipped')`,
      overridden: sql<string>`count(*) FILTER (WHERE ${ok} AND (${ticketTriage.categoryOverride} IS NOT NULL OR ${ticketTriage.priorityOverride} IS NOT NULL))`,
      categoryOverridden: sql<string>`count(*) FILTER (WHERE ${ok} AND ${ticketTriage.categoryOverride} IS NOT NULL)`,
      priorityOverridden: sql<string>`count(*) FILTER (WHERE ${ok} AND ${ticketTriage.priorityOverride} IS NOT NULL)`,
      autoApplied: sql<string>`count(*) FILTER (WHERE ${ok} AND (${ticketTriage.appliedCategory} OR ${ticketTriage.appliedPriority}))`,
      needsReview: sql<string>`count(*) FILTER (WHERE ${ok} AND ${ticketTriage.needsReview})`,
    })
    .from(ticketTriage)
    .where(and(eq(ticketTriage.workspaceId, workspaceId), gte(ticketTriage.createdAt, windowStart(days))));
  return {
    succeeded: num(row?.succeeded),
    failed: num(row?.failed),
    skipped: num(row?.skipped),
    overridden: num(row?.overridden),
    categoryOverridden: num(row?.categoryOverridden),
    priorityOverridden: num(row?.priorityOverridden),
    autoApplied: num(row?.autoApplied),
    needsReview: num(row?.needsReview),
  };
}

export interface FeatureCalls {
  feature: UsageFeature;
  calls: number;
  outcomes: Partial<Record<AiUsageOutcome, number>>;
  /** Successful calls only: a timeout's duration is the timeout setting, not the model's speed. */
  latencyMs: { n: number; p50: number | null; p95: number | null };
  /** Drafts only: time to the first text chunk (NFR-AI2). */
  ttftMs: { n: number; p50: number | null; p95: number | null } | null;
}

export interface DailyUsage {
  day: string;
  calls: number;
  tokens: number;
  costMicros: number;
}

export interface AiCallStats {
  features: FeatureCalls[];
  byModel: { model: string; calls: number }[];
  daily: DailyUsage[];
}

/**
 * The app's own AI calls (triage, drafts, embeddings). The evaluation grader (`grade`) is
 * excluded: it is test tooling, not usage (as on the AI settings page).
 */
export async function aiCallStats(db: Executor, workspaceId: string, days: number): Promise<AiCallStats> {
  const from = windowStart(days);
  const features = [...REPORTED_USAGE_FEATURES];
  const inWindow = and(
    eq(aiUsage.workspaceId, workspaceId),
    gte(aiUsage.createdAt, from),
    inArray(aiUsage.feature, features),
  );
  const okTimed = sql`${aiUsage.outcome} = 'ok' AND ${aiUsage.latencyMs} IS NOT NULL`;
  const okTtft = sql`${aiUsage.outcome} = 'ok' AND ${aiUsage.ttftMs} IS NOT NULL`;

  const [outcomeRows, timingRows, modelRows, daily] = await Promise.all([
    db
      .select({ feature: aiUsage.feature, outcome: aiUsage.outcome, calls: sql<string>`count(*)` })
      .from(aiUsage)
      .where(inWindow)
      .groupBy(aiUsage.feature, aiUsage.outcome),
    db
      .select({
        feature: aiUsage.feature,
        latencyN: sql<string>`count(*) FILTER (WHERE ${okTimed})`,
        latencyP50: sql<
          string | null
        >`percentile_disc(0.5) WITHIN GROUP (ORDER BY ${aiUsage.latencyMs}) FILTER (WHERE ${okTimed})`,
        latencyP95: sql<
          string | null
        >`percentile_disc(0.95) WITHIN GROUP (ORDER BY ${aiUsage.latencyMs}) FILTER (WHERE ${okTimed})`,
        ttftN: sql<string>`count(*) FILTER (WHERE ${okTtft})`,
        ttftP50: sql<
          string | null
        >`percentile_disc(0.5) WITHIN GROUP (ORDER BY ${aiUsage.ttftMs}) FILTER (WHERE ${okTtft})`,
        ttftP95: sql<
          string | null
        >`percentile_disc(0.95) WITHIN GROUP (ORDER BY ${aiUsage.ttftMs}) FILTER (WHERE ${okTtft})`,
      })
      .from(aiUsage)
      .where(inWindow)
      .groupBy(aiUsage.feature),
    db
      .select({ model: aiUsage.model, calls: sql<string>`count(*)` })
      .from(aiUsage)
      .where(inWindow)
      .groupBy(aiUsage.model)
      .orderBy(sql`count(*) DESC`, aiUsage.model),
    db.execute<{ day: string; calls: string; tokens: string; cost: string }>(sql`
      WITH d AS (
        SELECT generate_series(${from}, date_trunc('day', now(), 'UTC'), interval '1 day') AS day
      )
      SELECT to_char(d.day AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
             count(u.id) AS calls,
             coalesce(sum(u.input_tokens::bigint + u.output_tokens::bigint), 0) AS tokens,
             coalesce(sum(u.est_cost_micros::bigint), 0) AS cost
      FROM d
      LEFT JOIN ${aiUsage} u
        ON u.workspace_id = ${workspaceId}
       AND u.feature IN (${sql.join(
         features.map((f) => sql`${f}`),
         sql`, `,
       )})
       AND u.created_at >= d.day AND u.created_at < d.day + interval '1 day'
      GROUP BY d.day
      ORDER BY d.day
    `),
  ]);

  const byFeature = new Map<UsageFeature, FeatureCalls>();
  const entry = (feature: UsageFeature) => {
    let f = byFeature.get(feature);
    if (!f) {
      f = {
        feature,
        calls: 0,
        outcomes: {},
        latencyMs: { n: 0, p50: null, p95: null },
        ttftMs: feature === "draft" ? { n: 0, p50: null, p95: null } : null,
      };
      byFeature.set(feature, f);
    }
    return f;
  };
  for (const r of outcomeRows) {
    const f = entry(r.feature as UsageFeature);
    const calls = num(r.calls);
    f.calls += calls;
    f.outcomes[r.outcome] = (f.outcomes[r.outcome] ?? 0) + calls;
  }
  for (const r of timingRows) {
    const f = entry(r.feature as UsageFeature);
    f.latencyMs = { n: num(r.latencyN), p50: numOrNull(r.latencyP50), p95: numOrNull(r.latencyP95) };
    if (f.ttftMs) f.ttftMs = { n: num(r.ttftN), p50: numOrNull(r.ttftP50), p95: numOrNull(r.ttftP95) };
  }

  return {
    // Always every feature, in the settings page's order, so an unused feature shows as 0.
    features: features.map((f) => entry(f)),
    byModel: modelRows.map((r) => ({ model: r.model, calls: num(r.calls) })),
    daily: daily.rows.map((r) => ({
      day: r.day,
      calls: num(r.calls),
      tokens: num(r.tokens),
      costMicros: num(r.cost),
    })),
  };
}
