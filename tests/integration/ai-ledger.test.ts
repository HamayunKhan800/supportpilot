import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { getDb } from "@/server/platform/db/client";
import {
  EMBEDDING_DIMENSIONS,
  aiDailyCalls,
  aiDraft,
  aiDraftCitation,
  aiUsage,
  kbChunk,
  kbDocument,
  organization,
  ticket,
  ticketTriage,
  workspaceSettings,
} from "@/server/platform/db/schema";
import { transaction } from "@/server/platform/db/tx";
import { DAILY_CALL_SCOPE } from "@/server/modules/ai/config";
import { createAiGateway, createPostgresLedger } from "@/server/modules/ai/gateway";
import { createMockModels } from "@/server/modules/ai/models";
import {
  dailyCallsToday,
  getAiPolicy,
  insertAiUsageRecord,
  reserveDailyCall,
} from "@/server/modules/ai/repository";
import { insertAiUsage } from "@/server/modules/kb/repository";
import { insertTicket, type Ticket } from "@/server/modules/tickets/repository";
import { resetDatabase } from "./support/client";

/** M5 step 1: the AI usage ledger and migration 0004's constraints, against PostgreSQL. */

const db = () => getDb().db;

async function sqlState(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code;
  }
}

const newTicket = (workspaceId: string): Promise<Ticket> =>
  transaction((tx) =>
    insertTicket(tx, workspaceId, {
      subject: "Charged twice",
      customerName: "Casey Customer",
      customerEmail: "casey@example.test",
      accessTokenHash: createHash("sha256").update(randomBytes(32)).digest("base64url"),
      firstMessage: "My card was charged twice this month.",
    }),
  );

let acmeId: string, globexId: string, bareId: string;

beforeAll(async () => {
  await resetDatabase();
  acmeId = randomUUID();
  globexId = randomUUID();
  bareId = randomUUID();
  await db()
    .insert(organization)
    .values([
      { id: acmeId, name: "Acme", slug: "acme", createdAt: new Date() },
      { id: globexId, name: "Globex", slug: "globex", createdAt: new Date() },
      { id: bareId, name: "No settings", slug: "bare", createdAt: new Date() },
    ]);
  await db()
    .insert(workspaceSettings)
    .values([
      { workspaceId: acmeId, monthlyTokenBudget: 10_000 },
      { workspaceId: globexId, aiEnabled: false },
    ]);
});

beforeEach(async () => {
  await getDb().pool.query(`TRUNCATE "ai_usage", "ai_daily_calls"`);
});

describe("monthly token budget (D12a)", () => {
  it("returns null without a settings row, so callers fail closed", async () => {
    expect(await getAiPolicy(db(), bareId)).toBeNull();
  });

  it("sums triage and draft tokens of this workspace and this month only", async () => {
    await insertAiUsageRecord(db(), acmeId, {
      feature: "triage",
      model: "m",
      inputTokens: 300,
      outputTokens: 50,
      estCostMicros: 1,
    });
    await insertAiUsageRecord(db(), acmeId, {
      feature: "draft",
      model: "m",
      inputTokens: 1000,
      outputTokens: 400,
      estCostMicros: 1,
    });
    // Not counted: embeddings, another workspace, last month.
    await insertAiUsage(db(), acmeId, {
      feature: "embed",
      model: "e",
      inputTokens: 99_999,
      estCostMicros: 1,
    });
    await insertAiUsageRecord(db(), globexId, {
      feature: "draft",
      model: "m",
      inputTokens: 5000,
      estCostMicros: 1,
    });
    await db()
      .insert(aiUsage)
      .values({
        workspaceId: acmeId,
        feature: "draft",
        model: "m",
        inputTokens: 7777,
        estCostMicros: 1,
        createdAt: sql`date_trunc('month', now(), 'UTC') - interval '1 second'`,
      });
    expect(await getAiPolicy(db(), acmeId)).toEqual({
      aiEnabled: true,
      monthlyTokenBudget: 10_000,
      tokensUsedThisMonth: 1750,
    });
    expect(await getAiPolicy(db(), globexId)).toMatchObject({ aiEnabled: false, tokensUsedThisMonth: 5000 });
  });

  it("does not overflow on large totals (bigint sum)", async () => {
    for (let i = 0; i < 3; i++) {
      await insertAiUsageRecord(db(), acmeId, {
        feature: "draft",
        model: "m",
        inputTokens: 2_000_000_000,
        estCostMicros: 0,
      });
    }
    expect((await getAiPolicy(db(), acmeId))?.tokensUsedThisMonth).toBe(6_000_000_000);
  });

  it("existing embedding rows keep working: outcome defaults to ok, timing columns stay empty", async () => {
    await insertAiUsage(db(), acmeId, { feature: "embed", model: "e", inputTokens: 10, estCostMicros: 0 });
    const [row] = await db().select().from(aiUsage);
    expect(row).toMatchObject({ outcome: "ok", latencyMs: null, ttftMs: null, ticketId: null });
  });

  it("rejects unknown outcomes and negative timings", async () => {
    const base = { workspaceId: acmeId, feature: "draft" as const, model: "m", estCostMicros: 0 };
    expect(
      await sqlState(
        db()
          .insert(aiUsage)
          .values({ ...base, outcome: "great" as never }),
      ),
    ).toBe("23514");
    expect(
      await sqlState(
        db()
          .insert(aiUsage)
          .values({ ...base, latencyMs: -1 }),
      ),
    ).toBe("23514");
  });
});

describe("global daily call cap (D12b)", () => {
  it("reserves up to the limit, then refuses", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await reserveDailyCall(db(), DAILY_CALL_SCOPE, 3));
    expect(results).toEqual([true, true, true, false]);
    expect(await dailyCallsToday(db(), DAILY_CALL_SCOPE)).toBe(3);
  });

  it("never overshoots under concurrency (one atomic upsert per call)", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveDailyCall(db(), DAILY_CALL_SCOPE, 7)),
    );
    expect(results.filter(Boolean)).toHaveLength(7);
    expect(await dailyCallsToday(db(), DAILY_CALL_SCOPE)).toBe(7);
  });

  it("a limit of 0 refuses without writing; scopes are independent", async () => {
    expect(await reserveDailyCall(db(), DAILY_CALL_SCOPE, 0)).toBe(false);
    expect(await db().select().from(aiDailyCalls)).toHaveLength(0);
    expect(await reserveDailyCall(db(), "other", 1)).toBe(true);
    expect(await dailyCallsToday(db(), DAILY_CALL_SCOPE)).toBe(0);
  });

  it("counts per Pacific-time day: yesterday's full counter doesn't block today", async () => {
    await db()
      .insert(aiDailyCalls)
      .values({
        day: sql`(now() AT TIME ZONE 'America/Los_Angeles')::date - 1`,
        scope: DAILY_CALL_SCOPE,
        calls: 5,
      });
    expect(await reserveDailyCall(db(), DAILY_CALL_SCOPE, 5)).toBe(true);
    const { rows } = await getDb().pool.query<{ ok: boolean }>(
      `SELECT bool_and(day IN ((now() AT TIME ZONE 'America/Los_Angeles')::date,
                               (now() AT TIME ZONE 'America/Los_Angeles')::date - 1)) AS ok FROM ai_daily_calls`,
    );
    expect(rows[0]!.ok).toBe(true);
  });
});

describe("gateway with the Postgres ledger and the mock provider", () => {
  const schema = z.object({ category: z.enum(["billing", "bug"]) });
  const models = createMockModels({ triage: () => '{"category":"billing"}' });

  it("records the call with outcome, latency and ticket, and counts it against the cap", async () => {
    const t = await newTicket(acmeId);
    const gateway = createAiGateway({ models, ledger: createPostgresLedger(db()), dailyCallLimit: 5 });
    const result = await gateway.generateObject(
      { workspaceId: acmeId, ticketId: t.id },
      { feature: "triage", system: "Classify.", prompt: "Charged twice", schema },
    );
    expect(result.object).toEqual({ category: "billing" });
    const [row] = await db().select().from(aiUsage).where(eq(aiUsage.workspaceId, acmeId));
    expect(row).toMatchObject({
      feature: "triage",
      model: "mock-llm",
      outcome: "ok",
      ticketId: t.id,
      estCostMicros: 0,
    });
    expect(row!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(row!.inputTokens).toBeGreaterThan(0);
    expect(await dailyCallsToday(db(), DAILY_CALL_SCOPE)).toBe(1);
  });

  it("refuses a workspace with AI off, or without settings, before reserving anything", async () => {
    const gateway = createAiGateway({ models, ledger: createPostgresLedger(db()), dailyCallLimit: 5 });
    for (const workspaceId of [globexId, bareId]) {
      await expect(
        gateway.generateObject({ workspaceId }, { feature: "triage", system: "", prompt: "x", schema }),
      ).rejects.toMatchObject({ code: "ai_disabled" });
    }
    expect(await dailyCallsToday(db(), DAILY_CALL_SCOPE)).toBe(0);
  });

  it("stops at the budget: usage recorded by earlier calls blocks the next one", async () => {
    await insertAiUsageRecord(db(), acmeId, {
      feature: "draft",
      model: "m",
      inputTokens: 10_000,
      estCostMicros: 0,
    });
    const gateway = createAiGateway({ models, ledger: createPostgresLedger(db()), dailyCallLimit: 5 });
    await expect(
      gateway.generateObject({ workspaceId: acmeId }, { feature: "triage", system: "", prompt: "x", schema }),
    ).rejects.toMatchObject({ code: "ai_budget_exhausted" });
  });
});

describe("migration 0004 constraints", () => {
  const succeeded = {
    status: "succeeded" as const,
    model: "gemini-3.5-flash-lite",
    promptVersion: "triage.v1",
    category: "billing",
    priority: "high" as const,
    sentiment: "negative" as const,
    language: "en",
    confidence: 0.82,
    reason: "Customer reports a duplicate charge.",
  };

  it("ticket_triage: a complete successful run is accepted; incomplete or out-of-range ones are not", async () => {
    const t = await newTicket(acmeId);
    const base = { workspaceId: acmeId, ticketId: t.id };
    await db()
      .insert(ticketTriage)
      .values({ ...base, ...succeeded });
    const bad: Array<[string, Record<string, unknown>]> = [
      ["missing confidence", { ...succeeded, confidence: null }],
      ["confidence above 1", { ...succeeded, confidence: 1.5 }],
      ["three-letter language", { ...succeeded, language: "eng" }],
      ["upper-case language", { ...succeeded, language: "EN" }],
      ["reason over 200 chars", { ...succeeded, reason: "x".repeat(201) }],
      ["unknown sentiment", { ...succeeded, sentiment: "furious" }],
      ["unknown priority", { ...succeeded, priority: "asap" }],
      ["failed without a reason", { status: "failed" }],
      ["unknown status", { status: "maybe", errorCode: "x" }],
    ];
    for (const [label, values] of bad) {
      expect(
        await sqlState(
          db()
            .insert(ticketTriage)
            .values({ ...base, ...values } as never),
        ),
        label,
      ).toBe("23514");
    }
    await db()
      .insert(ticketTriage)
      .values({ ...base, status: "skipped", errorCode: "ai_budget_exhausted" });
  });

  it("triage, drafts and citations can't point at another workspace's ticket or draft", async () => {
    const acmeTicket = await newTicket(acmeId);
    expect(
      await sqlState(
        db()
          .insert(ticketTriage)
          .values({ workspaceId: globexId, ticketId: acmeTicket.id, ...succeeded }),
      ),
    ).toBe("23503");
    expect(
      await sqlState(
        db()
          .insert(aiDraft)
          .values({ workspaceId: globexId, ticketId: acmeTicket.id, promptVersion: "draft.v1" }),
      ),
    ).toBe("23503");
    const [draft] = await db()
      .insert(aiDraft)
      .values({ workspaceId: acmeId, ticketId: acmeTicket.id, promptVersion: "draft.v1" })
      .returning();
    expect(
      await sqlState(
        db()
          .insert(aiDraftCitation)
          .values({ workspaceId: globexId, draftId: draft!.id, marker: 1, documentTitle: "T", content: "C" }),
      ),
    ).toBe("23503");
  });

  it("ai_draft: failed/blocked need a reason, sent needs an edit ratio, values stay in range", async () => {
    const t = await newTicket(acmeId);
    const base = { workspaceId: acmeId, ticketId: t.id, promptVersion: "draft.v1" };
    const bad: Array<[string, Record<string, unknown>]> = [
      ["failed without reason", { status: "failed" }],
      ["blocked without reason", { status: "blocked" }],
      ["sent without edit ratio", { status: "sent" }],
      ["edit ratio above 1", { editRatio: 1.2 }],
      ["unknown status", { status: "published" }],
      ["unknown feedback", { feedback: "meh" }],
      ["negative tokens", { outputTokens: -5 }],
      ["long feedback note", { feedbackNote: "x".repeat(501) }],
    ];
    for (const [label, values] of bad) {
      expect(
        await sqlState(
          db()
            .insert(aiDraft)
            .values({ ...base, ...values } as never),
        ),
        label,
      ).toBe("23514");
    }
    const [ok] = await db()
      .insert(aiDraft)
      .values({ ...base, status: "sent", editRatio: 0.1, feedback: "up", warnings: ["unknown_link"] })
      .returning();
    expect(ok).toMatchObject({ status: "sent", warnings: ["unknown_link"], invalidCitationCount: 0 });
  });

  it("citations keep their snapshot when the article goes ('source removed'); markers are unique and 1–20", async () => {
    const t = await newTicket(acmeId);
    const [doc] = await db()
      .insert(kbDocument)
      .values({
        workspaceId: acmeId,
        title: "Refund policy",
        filename: "refunds.md",
        mimeType: "text/markdown",
        sizeBytes: 10,
        sha256: "a".repeat(64),
      })
      .returning();
    const unit = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
    const [chunk] = await db()
      .insert(kbChunk)
      .values({
        workspaceId: acmeId,
        documentId: doc!.id,
        ordinal: 0,
        content: "Refunds take 5 days.",
        tokenEstimate: 5,
        embedding: unit,
      })
      .returning();
    const [draft] = await db()
      .insert(aiDraft)
      .values({ workspaceId: acmeId, ticketId: t.id, promptVersion: "draft.v1" })
      .returning();
    const citation = {
      workspaceId: acmeId,
      draftId: draft!.id,
      chunkId: chunk!.id,
      documentId: doc!.id,
      documentTitle: "Refund policy",
      headingPath: "Billing › Refunds",
      content: "Refunds take 5 days.",
      similarity: 0.71,
    };
    await db()
      .insert(aiDraftCitation)
      .values({ ...citation, marker: 1 });
    expect(
      await sqlState(
        db()
          .insert(aiDraftCitation)
          .values({ ...citation, marker: 1 }),
      ),
    ).toBe("23505");
    expect(
      await sqlState(
        db()
          .insert(aiDraftCitation)
          .values({ ...citation, marker: 0 }),
      ),
    ).toBe("23514");
    expect(
      await sqlState(
        db()
          .insert(aiDraftCitation)
          .values({ ...citation, marker: 21 }),
      ),
    ).toBe("23514");

    await db().delete(kbDocument).where(eq(kbDocument.id, doc!.id)); // cascades to its chunks
    const [kept] = await db().select().from(aiDraftCitation).where(eq(aiDraftCitation.draftId, draft!.id));
    expect(kept).toMatchObject({
      chunkId: null,
      documentId: null,
      documentTitle: "Refund policy",
      content: "Refunds take 5 days.",
    });
  });

  it("deleting a ticket removes its triage runs, drafts and citations, and keeps usage history", async () => {
    const t = await newTicket(acmeId);
    await db()
      .insert(ticketTriage)
      .values({ workspaceId: acmeId, ticketId: t.id, ...succeeded });
    const [draft] = await db()
      .insert(aiDraft)
      .values({ workspaceId: acmeId, ticketId: t.id, promptVersion: "draft.v1" })
      .returning();
    await db()
      .insert(aiDraftCitation)
      .values({ workspaceId: acmeId, draftId: draft!.id, marker: 1, documentTitle: "T", content: "C" });
    await insertAiUsageRecord(db(), acmeId, {
      feature: "draft",
      model: "m",
      inputTokens: 5,
      estCostMicros: 0,
      ticketId: t.id,
    });

    await db().delete(ticket).where(eq(ticket.id, t.id));
    expect(await db().select().from(ticketTriage).where(eq(ticketTriage.ticketId, t.id))).toHaveLength(0);
    expect(await db().select().from(aiDraft).where(eq(aiDraft.id, draft!.id))).toHaveLength(0);
    expect(
      await db().select().from(aiDraftCitation).where(eq(aiDraftCitation.draftId, draft!.id)),
    ).toHaveLength(0);
    const usage = await db().select().from(aiUsage).where(eq(aiUsage.workspaceId, acmeId));
    expect(usage).toHaveLength(1);
    expect(usage[0]!.ticketId).toBeNull();
  });
});
