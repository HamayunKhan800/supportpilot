import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getEvaluationOverview,
  getUsageAnalytics,
  EVAL_TREND_RUNS,
} from "@/server/modules/analytics/service";
import * as ticketRepo from "@/server/modules/tickets/repository";
import { generateTrackingToken } from "@/server/modules/tickets/tracking-token";
import { wilson } from "@/server/modules/eval/stats";
import { getAuth } from "@/server/platform/auth";
import { getDb } from "@/server/platform/db/client";
import { aiDraft, aiUsage, evalRun, ticket, ticketTriage } from "@/server/platform/db/schema";
import { transaction } from "@/server/platform/db/tx";
import { AppError } from "@/server/platform/errors";
import { stopWebBoss } from "@/server/platform/jobs/boss";

import { resetDatabase, signUpAndIn, TestClient } from "./support/client";

/**
 * The analytics dashboard's data (FR-AN1, M6 step 5) against PostgreSQL: every number from
 * known rows, the time window's edges, tenant isolation, the evaluation grader kept out of
 * usage, the role check, and evaluation runs read safely.
 */

const handler = (req: Request) => getAuth().handler(req);
const db = () => getDb().db;

let owner: TestClient, agent: TestClient, globexOwner: TestClient, loner: TestClient;
let acmeId: string, globexId: string;

/** Midnight UTC at the start of an N-day window: the repository's own definition. */
const windowStart = (days: number) =>
  sql`(date_trunc('day', now(), 'UTC') - make_interval(days => ${days - 1}))`;
const daysAgo = (n: number) => sql`now() - make_interval(days => ${n})`;

async function newTicket(workspaceId: string, over: { status?: string; category?: string | null } = {}) {
  const t = await transaction((tx) =>
    ticketRepo.insertTicket(tx, workspaceId, {
      subject: "Analytics fixture",
      customerName: "Casey Customer",
      customerEmail: "casey@example.test",
      accessTokenHash: generateTrackingToken().hash,
      firstMessage: "Fixture message",
    }),
  );
  if (over.status || over.category !== undefined)
    await db()
      .update(ticket)
      .set({ status: (over.status ?? "open") as never, category: over.category ?? null })
      .where(eq(ticket.id, t.id));
  return t.id;
}

const setCreated = (
  table: typeof ticket | typeof aiUsage | typeof aiDraft | typeof ticketTriage,
  id: string,
  at: unknown,
) =>
  db()
    .update(table as typeof ticket)
    .set({ createdAt: at as Date })
    .where(eq((table as typeof ticket).id, id));

async function usage(workspaceId: string, values: Partial<typeof aiUsage.$inferInsert>, at?: unknown) {
  const [row] = await db()
    .insert(aiUsage)
    .values({ workspaceId, feature: "triage", model: "gemini-3.5-flash-lite", ...values })
    .returning({ id: aiUsage.id });
  if (at) await setCreated(aiUsage, row!.id, at);
}

async function draft(
  workspaceId: string,
  ticketId: string,
  values: Partial<typeof aiDraft.$inferInsert>,
  at?: unknown,
) {
  const [row] = await db()
    .insert(aiDraft)
    .values({ workspaceId, ticketId, promptVersion: "draft.v1", ...values })
    .returning({ id: aiDraft.id });
  if (at) await setCreated(aiDraft, row!.id, at);
}

const succeeded = {
  status: "succeeded" as const,
  model: "gemini-3.5-flash-lite",
  promptVersion: "triage.v1",
  category: "billing",
  priority: "high" as const,
  sentiment: "negative" as const,
  language: "en",
  confidence: 0.9,
};

async function triage(
  workspaceId: string,
  ticketId: string,
  values: Partial<typeof ticketTriage.$inferInsert>,
  at?: unknown,
) {
  const [row] = await db()
    .insert(ticketTriage)
    .values({ workspaceId, ticketId, ...succeeded, ...values } as typeof ticketTriage.$inferInsert)
    .returning({ id: ticketTriage.id });
  if (at) await setCreated(ticketTriage, row!.id, at);
}

async function expectStatus(promise: Promise<unknown>, status: number) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(status);
}

beforeAll(async () => {
  await resetDatabase();
  await db().delete(evalRun);
  owner = await signUpAndIn(handler, "owner@acme.test");
  agent = await signUpAndIn(handler, "agent@acme.test");
  globexOwner = await signUpAndIn(handler, "owner@globex.test");
  loner = await signUpAndIn(handler, "loner@example.test");
  acmeId = (await owner.post("/organization/create", { name: "Acme Support", slug: "acme" })).json.id;
  globexId = (await globexOwner.post("/organization/create", { name: "Globex", slug: "globex" })).json.id;
  const { user } = (await getAuth().api.getSession({ headers: agent.headers }))!;
  await getAuth().api.addMember({ body: { userId: user.id, role: "agent", organizationId: acmeId } });
  await agent.post("/organization/set-active", { organizationId: acmeId });

  // --- Acme: tickets -------------------------------------------------------------------------
  const today = await newTicket(acmeId, { status: "open", category: "billing" });
  const fiveDays = await newTicket(acmeId, { status: "resolved", category: "billing" });
  await setCreated(ticket, fiveDays, daysAgo(5));
  const uncategorised = await newTicket(acmeId, { status: "pending", category: null });
  await setCreated(ticket, uncategorised, daysAgo(10));
  const edge = await newTicket(acmeId, { status: "closed", category: "bug" });
  await setCreated(ticket, edge, windowStart(30)); // first instant of the 30-day window: in
  const before = await newTicket(acmeId, { status: "closed", category: "bug" });
  await setCreated(ticket, before, sql`${windowStart(30)} - interval '1 second'`); // just outside
  const old = await newTicket(acmeId, { status: "closed", category: "account" });
  await setCreated(ticket, old, daysAgo(40));

  // --- Acme: AI calls --------------------------------------------------------------------------
  for (const latencyMs of [100, 200, 300, 400])
    await usage(acmeId, { outcome: "ok", latencyMs, inputTokens: 100, outputTokens: 10, estCostMicros: 50 });
  await usage(acmeId, { outcome: "timeout", latencyMs: 9000 }); // not a speed measurement
  await usage(acmeId, { outcome: "invalid", latencyMs: 700 });
  await usage(acmeId, {
    feature: "draft",
    model: "gemini-3.8-flash",
    outcome: "ok",
    latencyMs: 4000,
    ttftMs: 900,
    inputTokens: 1000,
    outputTokens: 200,
    estCostMicros: 1500,
  });
  await usage(acmeId, {
    feature: "draft",
    model: "gemini-3.5-flash-lite",
    outcome: "ok",
    latencyMs: 2000,
    ttftMs: 300,
    inputTokens: 900,
    outputTokens: 100,
    estCostMicros: 500,
  });
  await usage(acmeId, { feature: "draft", model: "gemini-3.8-flash", outcome: "error" });
  await usage(
    acmeId,
    { feature: "embed", model: "gemini-embedding-2", outcome: "ok", inputTokens: 40 },
    daysAgo(5),
  );
  // The evaluation grader is test tooling, never usage.
  await usage(acmeId, {
    feature: "grade",
    model: "gemini-3.5-flash-lite",
    outcome: "ok",
    latencyMs: 1,
    inputTokens: 99_999,
    estCostMicros: 99_999,
  });
  await usage(acmeId, { outcome: "ok", latencyMs: 5, inputTokens: 7 }, daysAgo(40)); // outside 30 days

  // --- Acme: drafts ------------------------------------------------------------------------------
  await draft(acmeId, today, { status: "sent", editRatio: 0.1, feedback: "up" });
  await draft(acmeId, today, { status: "sent", editRatio: 0.5 });
  await draft(acmeId, fiveDays, { status: "sent", editRatio: 0.3, feedback: "down", feedbackReason: "tone" });
  // A ratio on a draft that was never sent is not an edit before sending.
  await draft(acmeId, fiveDays, {
    status: "discarded",
    editRatio: 0.9,
    feedback: "down",
    feedbackReason: "incorrect",
  });
  await draft(acmeId, today, { status: "ready" });
  // Rated helpful but not sent: counts as "up", not as a sent draft rated helpful.
  await draft(acmeId, today, { status: "ready", feedback: "up" });
  await draft(acmeId, today, { status: "refused", errorCode: "below_min_score" });
  await draft(acmeId, old, { status: "sent", editRatio: 1 }, daysAgo(40));

  // --- Acme: triage --------------------------------------------------------------------------------
  await triage(acmeId, today, { appliedCategory: true, appliedPriority: true });
  await triage(acmeId, fiveDays, { categoryOverride: "bug", appliedCategory: true });
  await triage(acmeId, uncategorised, { priorityOverride: "low", needsReview: true });
  // Only a cleared category: still an override.
  await triage(acmeId, edge, { categoryOverride: "", needsReview: true });
  await triage(acmeId, today, {
    status: "failed",
    errorCode: "ai_timeout",
    category: null,
    priority: null,
    sentiment: null,
    language: null,
    confidence: null,
    model: null,
    promptVersion: null,
  });
  await triage(acmeId, today, {
    status: "skipped",
    errorCode: "ai_disabled",
    category: null,
    priority: null,
    sentiment: null,
    language: null,
    confidence: null,
    model: null,
    promptVersion: null,
  });
  await triage(acmeId, old, { categoryOverride: "account" }, daysAgo(40));

  // --- Globex: one of everything, none of which may show in Acme's numbers --------------------
  const g = await newTicket(globexId, { status: "open", category: "billing" });
  await usage(globexId, { outcome: "ok", latencyMs: 1, inputTokens: 5000 });
  await draft(globexId, g, { status: "sent", editRatio: 0.9, feedback: "up" });
  await triage(globexId, g, { categoryOverride: "bug" });
});

afterAll(async () => {
  await db().delete(evalRun);
  await stopWebBoss();
});

describe("usage analytics (FR-AN1)", () => {
  it("tickets: created in the window, by current status and category, one bar per UTC day", async () => {
    const { tickets } = await getUsageAnalytics(owner.headers, 30);
    expect(tickets.created).toBe(4); // today, 5 and 10 days ago, and the window's first instant
    expect(tickets.byStatus).toEqual({ open: 1, resolved: 1, pending: 1, closed: 1 });
    expect(tickets.byCategory).toEqual([
      { category: "billing", count: 2 },
      { category: "bug", count: 1 },
      { category: null, count: 1 },
    ]);
    expect(tickets.daily).toHaveLength(30);
    expect(tickets.daily.reduce((n, d) => n + d.count, 0)).toBe(4);
    expect(tickets.daily[0]!.count).toBe(1); // the edge ticket, on the first day
    expect(tickets.daily[29]!.count).toBe(1); // today
    const today = (
      await db().execute<{ today: string }>(
        sql`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS today`,
      )
    ).rows[0]!.today;
    expect(tickets.daily[29]!.day).toBe(today);
    // Consecutive days, no gaps.
    for (let i = 1; i < 30; i++) {
      const prev = Date.parse(`${tickets.daily[i - 1]!.day}T00:00:00Z`);
      expect(Date.parse(`${tickets.daily[i]!.day}T00:00:00Z`) - prev).toBe(86_400_000);
    }
  });

  it("the window decides what counts", async () => {
    const week = await getUsageAnalytics(owner.headers, 7);
    expect(week.tickets.created).toBe(2);
    expect(week.tickets.daily).toHaveLength(7);
    const quarter = await getUsageAnalytics(owner.headers, 90);
    expect(quarter.tickets.created).toBe(6); // now including the two older ones
    expect(quarter.drafts.byStatus.sent).toBe(4);
    expect(quarter.triage.succeeded).toBe(5);
  });

  it("drafts: outcomes, edit ratio of sent drafts (nearest-rank median), feedback", async () => {
    const { drafts } = await getUsageAnalytics(owner.headers, 30);
    expect(drafts.byStatus).toEqual({ sent: 3, discarded: 1, ready: 2, refused: 1 });
    expect(drafts.edited.n).toBe(3);
    expect(drafts.edited.mean).toBeCloseTo(0.3);
    expect(drafts.edited.median).toBeCloseTo(0.3);
    expect(drafts.feedback).toEqual({ up: 2, down: 2, sentUp: 1 });
  });

  it("triage: suggestions, overrides (a cleared category counts), auto-applied, left for review", async () => {
    const { triage } = await getUsageAnalytics(owner.headers, 30);
    expect(triage).toEqual({
      succeeded: 4,
      failed: 1,
      skipped: 1,
      overridden: 3,
      categoryOverridden: 2,
      priorityOverridden: 1,
      autoApplied: 2,
      needsReview: 2,
    });
  });

  it("AI calls: outcomes, latency of successful calls only, first text for drafts, models, daily tokens and cost", async () => {
    const { ai } = await getUsageAnalytics(owner.headers, 30);
    expect(ai.features.map((f) => f.feature)).toEqual(["triage", "draft", "embed"]); // no "grade"
    const [triageCalls, draftCalls, embedCalls] = ai.features;
    expect(triageCalls).toMatchObject({
      calls: 6,
      outcomes: { ok: 4, timeout: 1, invalid: 1 },
      // Nearest rank over 100, 200, 300, 400: p50 = 200, p95 = 400. The 9 s timeout and the
      // 700 ms invalid answer are left out.
      latencyMs: { n: 4, p50: 200, p95: 400 },
      ttftMs: null,
    });
    expect(draftCalls).toMatchObject({
      calls: 3,
      outcomes: { ok: 2, error: 1 },
      latencyMs: { n: 2, p50: 2000, p95: 4000 },
      ttftMs: { n: 2, p50: 300, p95: 900 },
    });
    expect(embedCalls).toMatchObject({ calls: 1, latencyMs: { n: 0, p50: null, p95: null } });
    expect(ai.byModel).toEqual([
      { model: "gemini-3.5-flash-lite", calls: 7 },
      { model: "gemini-3.8-flash", calls: 2 },
      { model: "gemini-embedding-2", calls: 1 },
    ]);
    expect(ai.daily).toHaveLength(30);
    const total = ai.daily.reduce(
      (n, d) => ({ calls: n.calls + d.calls, tokens: n.tokens + d.tokens, cost: n.cost + d.costMicros }),
      { calls: 0, tokens: 0, cost: 0 },
    );
    expect(total).toEqual({ calls: 10, tokens: 4 * 110 + 1200 + 1000 + 40, cost: 4 * 50 + 1500 + 500 });
    expect(ai.daily[29]!.calls).toBe(9);
  });

  it("a workspace with no activity reads as zeros and nulls, not errors", async () => {
    const quiet = await signUpAndIn(handler, "owner@quiet.test");
    await quiet.post("/organization/create", { name: "Quiet", slug: "quiet" });
    const data = await getUsageAnalytics(quiet.headers, 7);
    expect(data.tickets).toMatchObject({ created: 0, byStatus: {}, byCategory: [] });
    expect(data.tickets.daily.every((d) => d.count === 0)).toBe(true);
    expect(data.drafts).toEqual({
      byStatus: {},
      edited: { n: 0, mean: null, median: null },
      feedback: { up: 0, down: 0, sentUp: 0 },
    });
    expect(data.triage.succeeded).toBe(0);
    expect(data.ai.features.every((f) => f.calls === 0 && f.latencyMs.p50 === null)).toBe(true);
    expect(data.ai.byModel).toEqual([]);
  });

  it("each workspace sees only its own numbers (T1)", async () => {
    const globex = await getUsageAnalytics(globexOwner.headers, 30);
    expect(globex.tickets.created).toBe(1);
    expect(globex.drafts).toMatchObject({ byStatus: { sent: 1 }, feedback: { up: 1, down: 0, sentUp: 1 } });
    expect(globex.triage).toMatchObject({ succeeded: 1, overridden: 1 });
    expect(globex.ai.features[0]).toMatchObject({ calls: 1, latencyMs: { p50: 1 } });
    expect(globex.ai.daily.reduce((n, d) => n + d.tokens, 0)).toBe(5000);
  });

  it("every role can read it (docs/01 section 2.1); no session is 401, no workspace 403", async () => {
    const asAgent = await getUsageAnalytics(agent.headers, 30);
    expect(asAgent.tickets.created).toBe(4);
    await expectStatus(getUsageAnalytics(new Headers(), 30), 401);
    await expectStatus(getUsageAnalytics(loner.headers, 30), 403);
    await expectStatus(getEvaluationOverview(new Headers(), null), 401);
    await expectStatus(getEvaluationOverview(loner.headers, null), 403);
  });
});

describe("evaluation overview", () => {
  const hash = (c: string) => c.repeat(64);
  const summary = (category: number) => ({
    items: { triage: 20 },
    triage: { category: wilson(category, 20) },
  });

  async function run(
    provider: "mock" | "gemini",
    startedDaysAgo: number,
    values: Partial<typeof evalRun.$inferInsert> = {},
  ) {
    const [row] = await db()
      .insert(evalRun)
      .values({
        provider,
        datasetHash: hash("a"),
        configHash: hash("b"),
        config: { promptVersions: { triage: "triage.v1" } },
        status: "completed",
        finishedAt: new Date(),
        summary: summary(10),
        ...values,
      })
      .returning({ id: evalRun.id });
    await db()
      .update(evalRun)
      .set({ startedAt: sql`now() - make_interval(days => ${startedDaysAgo})` as unknown as Date })
      .where(eq(evalRun.id, row!.id));
    return row!.id;
  }

  beforeEach(async () => {
    await db().delete(evalRun);
  });

  it("with no runs at all: mock, empty", async () => {
    expect(await getEvaluationOverview(owner.headers, null)).toEqual({
      provider: "mock",
      runCounts: {},
      runs: [],
    });
  });

  it("opens on Gemini once it has a run, newest first, and never exposes hashes", async () => {
    await run("mock", 1);
    const older = await run("gemini", 3, { summary: summary(15) });
    const newer = await run("gemini", 2, {
      status: "stopped",
      finishedAt: null,
      stopReason: "call budget of 60 reached",
    });
    const overview = await getEvaluationOverview(agent.headers, null);
    expect(overview.provider).toBe("gemini");
    expect(overview.runCounts).toEqual({ mock: 1, gemini: 2 });
    expect(overview.runs.map((r) => r.id)).toEqual([newer, older]);
    expect(overview.runs[0]).toMatchObject({
      status: "stopped",
      stopReason: "call budget of 60 reached",
      finishedAt: null,
    });
    for (const r of overview.runs) {
      expect(Object.keys(r)).not.toContain("datasetHash");
      expect(Object.keys(r)).not.toContain("configHash");
    }
    // Asking for mock still shows mock.
    expect((await getEvaluationOverview(owner.headers, "mock")).runs).toHaveLength(1);
  });

  it(`shows at most the last ${EVAL_TREND_RUNS} runs`, async () => {
    for (let i = 0; i < EVAL_TREND_RUNS + 2; i++) await run("mock", i + 1);
    const { runs } = await getEvaluationOverview(owner.headers, "mock");
    expect(runs).toHaveLength(EVAL_TREND_RUNS);
    const starts = runs.map((r) => r.startedAt.getTime());
    expect([...starts].sort((a, b) => b - a)).toEqual(starts);
  });

  it("returns a damaged or empty summary as stored, for the page to show as no data", async () => {
    await run("mock", 1, { summary: { triage: { category: "88%" } } });
    await run("mock", 2, { summary: null, status: "running", finishedAt: null });
    const { runs } = await getEvaluationOverview(owner.headers, "mock");
    expect(runs.map((r) => r.summary)).toEqual([{ triage: { category: "88%" } }, null]);
  });
});
