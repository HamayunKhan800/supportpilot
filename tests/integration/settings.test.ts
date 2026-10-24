import { and, desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RETRIEVAL_MIN_SCORE } from "@/server/modules/kb/retrieval";
import { DEFAULT_TRIAGE_CONFIDENCE_THRESHOLD } from "@/server/modules/triage/decide";

import { AiSettingsView, Problem } from "@/server/api/schemas";
import { createAiGateway, createPostgresLedger, type AiGatewayOptions } from "@/server/modules/ai/gateway";
import type { MockResponder } from "@/server/modules/ai/mock-model";
import { createMockModels } from "@/server/modules/ai/models";
import { getAiPolicy } from "@/server/modules/ai/repository";
import * as ticketRepo from "@/server/modules/tickets/repository";
import { generateTrackingToken } from "@/server/modules/tickets/tracking-token";
import { runTriageJob } from "@/server/modules/triage/job";
import { findLatestTriage } from "@/server/modules/triage/repository";
import { getAuth } from "@/server/platform/auth";
import { DEFAULT_CATEGORIES } from "@/server/platform/auth/workspace-settings";
import { getDb } from "@/server/platform/db/client";
import { aiUsage, auditLog, workspaceSettings } from "@/server/platform/db/schema";
import { transaction } from "@/server/platform/db/tx";
import { stopWebBoss } from "@/server/platform/jobs/boss";

import { call } from "./support/api";
import { resetDatabase, signUpAndIn, type TestClient } from "./support/client";

/**
 * The AI settings page's API (M5 step 5): what it reports, who can change it, how changes are
 * validated, versioned and audited, and that a saved setting really changes what the AI does.
 */

const handler = (req: Request) => getAuth().handler(req);
const db = () => getDb().db;
const quiet = { warn: () => {} } as unknown as AiGatewayOptions["logger"];
const quietJobLog = { info: () => {}, warn: () => {} };

let owner: TestClient, admin: TestClient, agent: TestClient, globexOwner: TestClient;
let acmeId: string, globexId: string;

async function addMember(client: TestClient, role: "admin" | "agent") {
  const { user } = (await getAuth().api.getSession({ headers: client.headers }))!;
  await getAuth().api.addMember({ body: { userId: user.id, role, organizationId: acmeId } });
  await client.post("/organization/set-active", { organizationId: acmeId });
}

const read = async (as: TestClient = owner) => {
  const res = await call("getAiSettings", { as });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return AiSettingsView.parse(res.json);
};

const patch = async (body: Record<string, unknown>, as: TestClient = owner) => {
  const version = body.version ?? (await read()).settings.version;
  return call("updateAiSettings", { as, body: { ...body, version } });
};

const row = async () =>
  (await db().select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, acmeId)))[0]!;

const settingsAudit = () =>
  db()
    .select({ metadata: auditLog.metadata, actorUserId: auditLog.actorUserId, targetId: auditLog.targetId })
    .from(auditLog)
    .where(and(eq(auditLog.workspaceId, acmeId), eq(auditLog.action, "settings.updated")))
    .orderBy(desc(auditLog.createdAt));

async function newTicket(subject: string, message: string) {
  return transaction((tx) =>
    ticketRepo.insertTicket(tx, acmeId, {
      subject,
      customerName: "Casey Customer",
      customerEmail: "casey@example.test",
      accessTokenHash: generateTrackingToken().hash,
      firstMessage: message,
    }),
  );
}

const triageAnswer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    category: "billing",
    priority: "high",
    sentiment: "negative",
    language: "en",
    confidence: 0.8,
    reason: "Refund request.",
    ...over,
  });

const runTriage = (ticketId: string, answer: string) =>
  runTriageJob(
    { workspaceId: acmeId, ticketId },
    { isFinalAttempt: true },
    {
      gateway: createAiGateway({
        models: createMockModels({ triage: (() => answer) as MockResponder }),
        ledger: createPostgresLedger(db()),
        dailyCallLimit: 10_000,
        logger: quiet,
      }),
      logger: quietJobLog,
    },
  );

beforeAll(async () => {
  await resetDatabase();
  owner = await signUpAndIn(handler, "owner@acme.test");
  admin = await signUpAndIn(handler, "admin@acme.test");
  agent = await signUpAndIn(handler, "agent@acme.test");
  globexOwner = await signUpAndIn(handler, "owner@globex.test");
  acmeId = (await owner.post("/organization/create", { name: "Acme Support", slug: "acme" })).json.id;
  globexId = (await globexOwner.post("/organization/create", { name: "Globex", slug: "globex" })).json.id;
  await addMember(admin, "admin");
  await addMember(agent, "agent");
});

afterAll(async () => {
  await stopWebBoss();
});

describe("reading the settings", () => {
  it("a new workspace starts with the defaults", async () => {
    const { settings } = await read();
    expect(settings).toMatchObject({
      version: 1,
      aiEnabled: true,
      monthlyTokenBudget: 1_000_000,
      triageConfidenceThreshold: DEFAULT_TRIAGE_CONFIDENCE_THRESHOLD, // 0.95 since the M6 baseline
      retrievalMinScore: DEFAULT_RETRIEVAL_MIN_SCORE, // the migrated database default matches the code
      categories: DEFAULT_CATEGORIES,
      // Tests run with the offline mock embedder, which has its own floor (finding #89).
      retrievalMinScoreApplies: false,
    });
  });

  it("every role can read them", async () => {
    for (const as of [owner, admin, agent]) expect((await read(as)).settings.version).toBeGreaterThan(0);
  });

  it("reports this month's usage per feature, for this workspace only", async () => {
    const lastMonth = sql`date_trunc('month', now(), 'UTC') - interval '1 day'`;
    const base = { model: "gemini-3.8-flash", outputTokens: 0, estCostMicros: 0 };
    await db()
      .insert(aiUsage)
      .values([
        {
          ...base,
          workspaceId: acmeId,
          feature: "triage",
          inputTokens: 100,
          outputTokens: 20,
          estCostMicros: 50,
        },
        {
          ...base,
          workspaceId: acmeId,
          feature: "draft",
          inputTokens: 1000,
          outputTokens: 200,
          estCostMicros: 1500,
        },
        { ...base, workspaceId: acmeId, feature: "draft", inputTokens: 0, outcome: "refused" },
        {
          ...base,
          workspaceId: acmeId,
          feature: "draft",
          inputTokens: 500,
          estCostMicros: 375,
          outcome: "timeout",
        },
        { ...base, workspaceId: acmeId, feature: "embed", inputTokens: 300, estCostMicros: 60 },
        // The evaluation's grader (M6 step 3): never shown here and never counted in the budget.
        { ...base, workspaceId: acmeId, feature: "grade", inputTokens: 4_444, estCostMicros: 99 },
        // Not this month, and not this workspace: neither may be counted.
        { ...base, workspaceId: acmeId, feature: "draft", inputTokens: 9_999, createdAt: lastMonth },
        { ...base, workspaceId: globexId, feature: "draft", inputTokens: 7_777 },
      ] as (typeof aiUsage.$inferInsert)[]);

    const { usage } = await read();
    expect(usage.features.map((f) => f.feature)).toEqual(["triage", "draft", "embed"]);
    const [triage, draft, embed] = usage.features;
    expect(triage).toMatchObject({ calls: 1, inputTokens: 100, outputTokens: 20, countsTowardBudget: true });
    expect(triage!.estimatedCostUsd).toBeCloseTo(0.00005, 10);
    expect(draft).toMatchObject({
      calls: 3,
      inputTokens: 1500,
      outputTokens: 200,
      outcomes: { ok: 1, refused: 1, timeout: 1 },
    });
    expect(draft!.estimatedCostUsd).toBeCloseTo(0.001875, 10);
    // Embeddings are shown, but the budget counts generation only.
    expect(embed).toMatchObject({ calls: 1, inputTokens: 300, countsTowardBudget: false });
    expect(usage.budgetTokensUsed).toBe(100 + 20 + 1500 + 200);
    // The page shows the same number the budget check uses.
    expect(usage.budgetTokensUsed).toBe((await getAiPolicy(db(), acmeId))!.tokensUsedThisMonth);
    expect(new Date(usage.since).getUTCDate()).toBe(1);

    const globex = await read(globexOwner);
    expect(globex.usage.budgetTokensUsed).toBe(7_777);
    expect(globex.settings.version).toBe(1);
  });
});

describe("changing the settings", () => {
  beforeEach(async () => {
    await db()
      .update(workspaceSettings)
      .set({
        aiEnabled: true,
        monthlyTokenBudget: 1_000_000,
        triageConfidenceThreshold: 0.7,
        retrievalMinScore: 0.65,
        categories: DEFAULT_CATEGORIES,
      })
      .where(eq(workspaceSettings.workspaceId, acmeId));
  });

  it("saves only what was sent, bumps the version and audits each changed field", async () => {
    const before = await row();
    const auditBefore = (await settingsAudit()).length;
    const res = await patch({ monthlyTokenBudget: 250_000, triageConfidenceThreshold: 0.85 }, admin);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const view = AiSettingsView.parse(res.json);
    expect(view.settings).toMatchObject({
      version: before.version + 1,
      monthlyTokenBudget: 250_000,
      triageConfidenceThreshold: 0.85,
      aiEnabled: true,
      retrievalMinScore: 0.65,
      categories: DEFAULT_CATEGORIES,
    });

    const all = await settingsAudit();
    const entries = all.slice(0, all.length - auditBefore);
    expect(
      entries.map((e) => e.metadata).sort((a, b) => String(a.field).localeCompare(String(b.field))),
    ).toEqual([
      { field: "monthlyTokenBudget", from: 1_000_000, to: 250_000 },
      { field: "triageConfidenceThreshold", from: 0.7, to: 0.85 },
    ]);
    const { user } = (await getAuth().api.getSession({ headers: admin.headers }))!;
    for (const e of entries) expect(e).toMatchObject({ actorUserId: user.id, targetId: acmeId });
  });

  it("records categories and the AI switch readably in the audit log", async () => {
    const auditBefore = (await settingsAudit()).length;
    expect((await patch({ aiEnabled: false, categories: ["billing", "refunds"] })).status).toBe(200);
    const all = await settingsAudit();
    const entries = all.slice(0, all.length - auditBefore).map((e) => e.metadata);
    expect(entries).toEqual(
      expect.arrayContaining([
        { field: "aiEnabled", from: true, to: false },
        { field: "categories", from: DEFAULT_CATEGORIES.join(", "), to: "billing, refunds" },
      ]),
    );
  });

  it("sending the current values changes nothing: no audit entries, same version", async () => {
    const before = await row();
    const auditBefore = (await settingsAudit()).length;
    const res = await patch({ monthlyTokenBudget: before.monthlyTokenBudget, categories: before.categories });
    expect(res.status).toBe(200);
    expect(res.json.settings.version).toBe(before.version);
    expect((await settingsAudit()).length).toBe(auditBefore);
  });

  it("a stale version is refused with 409 and nothing changes", async () => {
    const before = await row();
    expect((await patch({ monthlyTokenBudget: 5 })).status).toBe(200);
    const res = await patch({ monthlyTokenBudget: 7, version: before.version });
    expect(res.status).toBe(409);
    expect(Problem.parse(res.json).type).toMatch(/\/settings_stale$/);
    expect((await row()).monthlyTokenBudget).toBe(5);
  });

  it("two saves from the same version: exactly one wins", async () => {
    const { version } = await row();
    const results = await Promise.all([
      patch({ version, monthlyTokenBudget: 111 }, owner),
      patch({ version, triageConfidenceThreshold: 0.9 }, admin),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const after = await row();
    expect(after.version).toBe(version + 1);
    // Only the winner's change is there.
    const ownerWon = results[0]!.status === 200;
    expect(after.monthlyTokenBudget).toBe(ownerWon ? 111 : 1_000_000);
    expect(after.triageConfidenceThreshold).toBeCloseTo(ownerWon ? 0.7 : 0.9, 5);
  });

  it("agents can't change them (403) and nothing changes", async () => {
    const before = await row();
    const res = await patch({ aiEnabled: false }, agent);
    expect(res.status).toBe(403);
    expect(await row()).toEqual(before);
  });

  it("another workspace's owner only ever changes their own workspace", async () => {
    const before = await row();
    const res = await call("updateAiSettings", {
      as: globexOwner,
      body: { version: 1, monthlyTokenBudget: 42 },
    });
    expect(res.status).toBe(200);
    expect(await row()).toEqual(before);
    expect((await read(globexOwner)).settings.monthlyTokenBudget).toBe(42);
  });

  it.each([
    ["an unknown field", { workspaceId: "other" }],
    ["nothing to update", {}],
    ["a negative budget", { monthlyTokenBudget: -1 }],
    ["a fractional budget", { monthlyTokenBudget: 10.5 }],
    ["a budget over the maximum", { monthlyTokenBudget: 100_000_001 }],
    ["a threshold below 0.5", { triageConfidenceThreshold: 0.45 }],
    ["a threshold above 1", { triageConfidenceThreshold: 1.01 }],
    ["a match score above 0.95", { retrievalMinScore: 0.96 }],
    ["a negative match score", { retrievalMinScore: -0.1 }],
    ["no categories", { categories: [] }],
    ["a duplicate category", { categories: ["billing", "billing"] }],
    ["an upper-case category", { categories: ["Billing"] }],
    ["a category with spaces", { categories: ["feature request"] }],
    ["a category that is too long", { categories: ["a".repeat(33)] }],
    ["too many categories", { categories: Array.from({ length: 21 }, (_, i) => `c${i}`) }],
    ["a string instead of a boolean", { aiEnabled: "false" }],
  ])("rejects %s with 400 and changes nothing", async (_name, body) => {
    const before = await row();
    const res = await patch(body);
    expect(res.status, JSON.stringify(res.json)).toBe(400);
    Problem.parse(res.json);
    expect(await row()).toEqual(before);
  });

  it("accepts the edges of each range and rounds to two decimals", async () => {
    const res = await patch({
      monthlyTokenBudget: 0,
      triageConfidenceThreshold: 0.7000000001,
      retrievalMinScore: 0.95,
      categories: ["a", "feature-request-2"],
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.settings).toMatchObject({
      monthlyTokenBudget: 0,
      triageConfidenceThreshold: 0.7,
      retrievalMinScore: 0.95,
      categories: ["a", "feature-request-2"],
    });
  });

  it("the database refuses out-of-range values even without the API (backstop)", async () => {
    await expect(
      db()
        .update(workspaceSettings)
        .set({ monthlyTokenBudget: -5 })
        .where(eq(workspaceSettings.workspaceId, acmeId)),
    ).rejects.toThrow();
    await expect(
      db()
        .update(workspaceSettings)
        .set({ retrievalMinScore: 1.5 })
        .where(eq(workspaceSettings.workspaceId, acmeId)),
    ).rejects.toThrow();
  });
});

describe("a saved setting changes what the AI does", () => {
  beforeEach(async () => {
    await db()
      .update(workspaceSettings)
      .set({
        aiEnabled: true,
        monthlyTokenBudget: 1_000_000,
        triageConfidenceThreshold: 0.7,
        categories: DEFAULT_CATEGORIES,
      })
      .where(eq(workspaceSettings.workspaceId, acmeId));
  });

  async function draftError(ticketId: string) {
    const res = await call("generateDraft", { as: owner, params: { id: ticketId } });
    expect(res.status).toBe(200);
    return res.events.at(-1) as Record<string, unknown>;
  }

  it("budget set to 0: drafts stop with 'budget used up'", async () => {
    const t = await newTicket("Refund please", "I would like a refund for last month.");
    expect((await patch({ monthlyTokenBudget: 0 })).status).toBe(200);
    expect(await draftError(t.id)).toMatchObject({
      type: "error",
      code: "ai_budget_exhausted",
      retryable: false,
    });
  });

  it("AI switched off: drafts and triage stop", async () => {
    const t = await newTicket("Refund please", "I would like a refund for last month.");
    expect((await patch({ aiEnabled: false })).status).toBe(200);
    expect(await draftError(t.id)).toMatchObject({ type: "error", code: "ai_disabled" });
    expect(await runTriage(t.id, triageAnswer())).toMatchObject({
      status: "skipped",
      errorCode: "ai_disabled",
    });
  });

  it("a stricter threshold leaves a 0.8-confidence label as a suggestion", async () => {
    const t1 = await newTicket("Refund please", "I would like a refund for last month.");
    await runTriage(t1.id, triageAnswer());
    expect((await ticketRepo.findTicketById(acmeId, t1.id))!.category).toBe("billing");

    expect((await patch({ triageConfidenceThreshold: 0.85 })).status).toBe(200);
    const t2 = await newTicket("Refund again", "Another refund request for last month.");
    await runTriage(t2.id, triageAnswer());
    expect((await ticketRepo.findTicketById(acmeId, t2.id))!.category).toBeNull();
    expect(await findLatestTriage(db(), acmeId, t2.id)).toMatchObject({
      category: "billing",
      appliedCategory: false,
    });
  });

  it("edited categories: triage and agents can use new ones, not removed ones", async () => {
    const t = await newTicket("Refund please", "I would like a refund for last month.");
    // Before: "refunds" is not a category, so the model's answer fails the schema.
    expect(await runTriage(t.id, triageAnswer({ category: "refunds" }))).toMatchObject({
      errorCode: "ai_invalid_output",
    });

    const categories = [...DEFAULT_CATEGORIES.filter((c) => c !== "billing"), "refunds"];
    expect((await patch({ categories })).status).toBe(200);
    // A ticket is triaged once, so the "after" check needs a new one.
    const after = await newTicket("Refund please", "I would like a refund for this month.");
    expect(await runTriage(after.id, triageAnswer({ category: "refunds" }))).toMatchObject({
      status: "succeeded",
    });
    expect((await ticketRepo.findTicketById(acmeId, after.id))!.category).toBe("refunds");

    const t2 = await newTicket("Charged twice", "I was charged twice.");
    const version = (await ticketRepo.findTicketById(acmeId, t2.id))!.version;
    const removed = await call("updateTicket", {
      as: agent,
      params: { id: t2.id },
      body: { version, category: "billing" },
    });
    expect(removed.status).toBe(400);
    const added = await call("updateTicket", {
      as: agent,
      params: { id: t2.id },
      body: { version, category: "refunds" },
    });
    expect(added.status, JSON.stringify(added.json)).toBe(200);
  });
});
