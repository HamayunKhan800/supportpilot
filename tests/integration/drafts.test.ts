import { and, eq } from "drizzle-orm";
import { APICallError } from "ai";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DraftStreamEvent } from "@/server/api/schemas";
import { createAiGateway, createPostgresLedger, type AiGatewayOptions } from "@/server/modules/ai/gateway";
import type { MockRequest, MockResponder } from "@/server/modules/ai/mock-model";
import { createMockModels } from "@/server/modules/ai/models";
import { mockDraftResponder } from "@/server/modules/drafts/mock-responder";
import { getOpenDraft } from "@/server/modules/drafts/actions";
import { findDraft, insertDraft } from "@/server/modules/drafts/repository";
import type { ApiDraft } from "@/server/modules/drafts/serialize";
import {
  DRAFT_RATE_LIMITS,
  draftRateLimitKeys,
  startDraft,
  type DraftDeps,
} from "@/server/modules/drafts/service";
import { createMockEmbedder, type Embedder } from "@/server/modules/kb/embedder";
import { IngestError } from "@/server/modules/kb/ingest-errors";
import { runIngestJob } from "@/server/modules/kb/ingest-job";
import * as ticketRepo from "@/server/modules/tickets/repository";
import { generateTrackingToken } from "@/server/modules/tickets/tracking-token";
import { insertTriageRun } from "@/server/modules/triage/repository";
import { getAuth } from "@/server/platform/auth";
import { getWorkspaceContext } from "@/server/platform/auth/context";
import { getDb } from "@/server/platform/db/client";
import {
  aiDraft,
  aiUsage,
  appRateLimit,
  auditLog,
  ticket,
  workspaceSettings,
} from "@/server/platform/db/schema";
import { transaction } from "@/server/platform/db/tx";
import { stopWebBoss } from "@/server/platform/jobs/boss";
import { consumeRateLimit } from "@/server/platform/rate-limit";

import { call, parseNdjson } from "./support/api";
import { resetDatabase, signUpAndIn, type TestClient } from "./support/client";

/**
 * Reply drafts end to end (M5 D6–D15): HTTP checks, the refusal gate, the prompt's contents,
 * output checks and every failure path, with real Postgres, real retrieval over the mock
 * embedder and the mock (or a scripted) model. Each test asserts both the stream and the row.
 */

const handler = (req: Request) => getAuth().handler(req);
const db = () => getDb().db;
const quiet = { warn: () => {} } as unknown as AiGatewayOptions["logger"];
const quietLog = { info: () => {}, warn: () => {}, error: () => {} };
const embedder = createMockEmbedder();

let owner: TestClient, agent: TestClient, globexOwner: TestClient;
let acmeId: string, globexId: string;

const REFUNDS = `# Refunds

Annual plans can be refunded within 30 days of purchase. Monthly plans are not refundable.
Refunds reach your card in 5 to 10 business days. Invoices are at https://help.acme.test/billing.`;

const SYNC = `# Sync troubleshooting

If sync stops, sign out of the desktop app and sign back in. Sync needs version 4.2 or later.`;

const REFUND_QUESTION = [
  "Refund for annual plan",
  "Can I get a refund on my annual plan? I bought it last week.",
] as const;

function gatewayWith(respond: MockResponder = mockDraftResponder, over: Partial<AiGatewayOptions> = {}) {
  return createAiGateway({
    models: createMockModels({ draft: respond }),
    ledger: createPostgresLedger(db()),
    dailyCallLimit: 10_000,
    logger: quiet,
    ...over,
  });
}

/** A responder that records each request and replays `answers` in order (errors are thrown). */
function scripted(...answers: Array<string | Error | ((r: MockRequest) => string)>) {
  const requests: MockRequest[] = [];
  const fn: MockResponder = (request) => {
    const next = answers[Math.min(requests.length, answers.length - 1)]!;
    requests.push(request);
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(request) : next;
  };
  return Object.assign(fn, { requests });
}

const busy = () =>
  new APICallError({
    message: "overloaded",
    url: "https://example.test",
    requestBodyValues: {},
    statusCode: 503,
  });

/** An embedder that counts query embeddings (retrieval calls). */
function countingEmbedder(base: Embedder = embedder) {
  const spy = { calls: 0 };
  const e: Embedder = {
    ...base,
    modelId: base.modelId,
    embedQuery: async (q, s) => (spy.calls++, base.embedQuery(q, s)),
  };
  return Object.assign(e, spy);
}

async function newTicket(workspaceId: string, subject: string, message: string) {
  return transaction((tx) =>
    ticketRepo.insertTicket(tx, workspaceId, {
      subject,
      customerName: "Casey Customer",
      customerEmail: "casey@example.test",
      accessTokenHash: generateTrackingToken().hash,
      firstMessage: message,
    }),
  );
}

async function uploadReady(as: TestClient, workspaceId: string, name: string, content: string) {
  const fd = new FormData();
  fd.set("file", new File([content], name, { type: "text/markdown" }));
  const res = await call("uploadKbDocument", { as, body: fd });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  const outcome = await runIngestJob(
    { workspaceId, documentId: res.json.id },
    { isFinalAttempt: true },
    { embedder },
  );
  expect(outcome.status).toBe("ready");
}

type Event = Record<string, unknown> & { type: string };

/** Runs the draft service directly (to inject a model or embedder) and reads every event. */
async function generate(
  ticketId: string,
  opts: { as?: TestClient; deps?: DraftDeps; respond?: MockResponder; signal?: AbortSignal } = {},
) {
  const stream = await startDraft((opts.as ?? owner).headers, ticketId, {
    signal: opts.signal,
    deps: {
      gateway: gatewayWith(opts.respond),
      embedder,
      logger: quietLog,
      ...opts.deps,
    },
  });
  const events = parseNdjson(await new Response(stream).text()) as Event[];
  for (const e of events) DraftStreamEvent.parse(e);
  const last = events.at(-1)!;
  return { events, last, draft: last.draft as Record<string, unknown> | undefined };
}

const rowOf = async (draftId: string) => (await findDraft(db(), acmeId, draftId))!.draft;
const draftUsage = (ticketId: string) =>
  db()
    .select()
    .from(aiUsage)
    .where(and(eq(aiUsage.ticketId, ticketId), eq(aiUsage.feature, "draft")));

async function setSettings(values: Partial<typeof workspaceSettings.$inferInsert>) {
  await db().update(workspaceSettings).set(values).where(eq(workspaceSettings.workspaceId, acmeId));
}

beforeAll(async () => {
  await resetDatabase();
  owner = await signUpAndIn(handler, "owner@acme.test");
  agent = await signUpAndIn(handler, "agent@acme.test");
  globexOwner = await signUpAndIn(handler, "owner@globex.test");
  acmeId = (await owner.post("/organization/create", { name: "Acme Support", slug: "acme" })).json.id;
  globexId = (await globexOwner.post("/organization/create", { name: "Globex", slug: "globex" })).json.id;
  const agentCtx = await getWorkspaceContext(agent.headers).catch(() => null);
  expect(agentCtx).toBeNull(); // not a member yet
  const { user } = (await getAuth().api.getSession({ headers: agent.headers }))!;
  await getAuth().api.addMember({ body: { userId: user.id, role: "agent", organizationId: acmeId } });
  await agent.post("/organization/set-active", { organizationId: acmeId });
  await uploadReady(owner, acmeId, "refunds.md", REFUNDS);
  await uploadReady(owner, acmeId, "sync.md", SYNC);
});

beforeEach(async () => {
  await db().delete(appRateLimit);
  await setSettings({ aiEnabled: true, monthlyTokenBudget: 1_000_000, retrievalMinScore: 0.65 });
});

afterAll(async () => {
  await stopWebBoss();
});

describe("POST /api/v1/tickets/{id}/drafts", () => {
  it("streams NDJSON: start, the text as it is written, then the checked draft", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const res = await call("generateDraft", { as: agent, params: { id: t.id } });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-encoding")).toBe("none");
    const events = res.events as Event[];
    for (const e of events) DraftStreamEvent.parse(e);
    expect(events[0]).toEqual({ type: "start", draftId: expect.any(String) });
    expect(events.slice(1, -1).every((e) => e.type === "delta")).toBe(true);
    expect(events.length).toBeGreaterThan(3); // streamed in pieces, not one blob

    const done = events.at(-1)!;
    expect(done.type).toBe("done");
    const draft = done.draft as ApiDraft;
    expect(draft).toMatchObject({
      id: events[0]!.draftId,
      ticketId: t.id,
      status: "ready",
      errorCode: null,
      model: "mock-llm",
      promptVersion: "draft.v1",
      invalidCitationCount: 0,
      warnings: [],
    });
    expect(draft.body).toContain("Annual plans can be refunded within 30 days of purchase");
    expect(draft.body).toMatch(/\[1\]/);
    expect(
      events
        .slice(1, -1)
        .map((e) => e.text)
        .join(""),
    ).toBe(draft.body);
    expect(draft.citations[0]).toMatchObject({
      marker: 1,
      documentTitle: "refunds",
      headingPath: "Refunds",
      sourceRemoved: false,
    });
    expect(draft.citations[0]!.content).toContain("Annual plans can be refunded");
    expect(draft.retrievalTopScore).toBeGreaterThan(0.15);
    expect(draft.usage.outputTokens).toBeGreaterThan(0);
    expect(draft.latencyMs).toBeGreaterThanOrEqual(draft.ttftMs!);

    const row = await rowOf(draft.id);
    const agentUser = (await getAuth().api.getSession({ headers: agent.headers }))!.user;
    expect(row).toMatchObject({ status: "ready", requestedBy: agentUser.id, workspaceId: acmeId });
    expect(await draftUsage(t.id)).toHaveLength(1);
  });

  it("returns ordinary HTTP errors before the stream starts", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    expect((await call("generateDraft", { params: { id: t.id } })).status).toBe(401);
    expect((await call("generateDraft", { as: owner, params: { id: "not-a-uuid" } })).status).toBe(404);
    expect((await call("generateDraft", { as: owner, params: { id: crypto.randomUUID() } })).status).toBe(
      404,
    );
    expect((await call("generateDraft", { as: owner, params: { id: t.id }, noOrigin: true })).status).toBe(
      403,
    );
  });

  it("another workspace's ticket is 404 and leaves no draft behind (tenant isolation)", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const res = await call("generateDraft", { as: globexOwner, params: { id: t.id } });
    expect(res.status).toBe(404);
    expect(await db().select().from(aiDraft).where(eq(aiDraft.ticketId, t.id))).toEqual([]);
  });

  it("a closed ticket is 409: there is no reply to draft", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    await db().update(ticket).set({ status: "closed" }).where(eq(ticket.id, t.id));
    const res = await call("generateDraft", { as: owner, params: { id: t.id } });
    expect(res.status).toBe(409);
    expect(res.json.type).toMatch(/ticket_closed$/);
  });

  it("is rate limited per user (429 with Retry-After), without creating a draft", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const ctx = (await getWorkspaceContext(agent.headers))!;
    for (let i = 0; i < DRAFT_RATE_LIMITS.perUser.max; i++) {
      await consumeRateLimit(draftRateLimitKeys(ctx).user, DRAFT_RATE_LIMITS.perUser);
    }
    const res = await call("generateDraft", { as: agent, params: { id: t.id } });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await db().select().from(aiDraft).where(eq(aiDraft.ticketId, t.id))).toEqual([]);
    // Other users of the workspace are not affected.
    expect((await call("generateDraft", { as: owner, params: { id: t.id } })).status).toBe(200);
  });

  it("is rate limited per workspace", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const ctx = (await getWorkspaceContext(owner.headers))!;
    for (let i = 0; i < DRAFT_RATE_LIMITS.perWorkspace.max; i++) {
      await consumeRateLimit(draftRateLimitKeys(ctx).workspace, DRAFT_RATE_LIMITS.perWorkspace);
    }
    expect((await call("generateDraft", { as: agent, params: { id: t.id } })).status).toBe(429);
  });
});

describe("what the model sees (D11, D15)", () => {
  it("sends the passages and the conversation, never internal notes or the customer's identity", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    await transaction((tx) =>
      ticketRepo.insertMessage(tx, acmeId, t.id, {
        authorType: "agent",
        authorUserId: null,
        body: "SECRET-NOTE: customer threatened a chargeback",
        isInternal: true,
      }),
    );
    const respond = scripted(mockDraftResponder);
    await generate(t.id, { respond });

    const [request] = respond.requests;
    expect(request!.prompt).toContain("Annual plans can be refunded within 30 days");
    expect(request!.prompt).toContain("I bought it last week.");
    for (const secret of ["SECRET-NOTE", "Casey", "casey@example.test"]) {
      expect(request!.prompt).not.toContain(secret);
      expect(request!.system).not.toContain(secret);
    }
    expect(request!.system).toMatch(/Confidential reference: SP-CANARY-/);
  });

  it("asks for the language triage detected and records it", async () => {
    const t = await newTicket(
      acmeId,
      "Reembolso del plan anual",
      "¿Puedo obtener un reembolso del plan anual (annual plan refund)?",
    );
    await transaction((tx) =>
      insertTriageRun(tx, acmeId, t.id, {
        status: "succeeded",
        model: "mock-llm",
        promptVersion: "triage.v1",
        category: "billing",
        priority: "normal",
        sentiment: "neutral",
        language: "es",
        confidence: 0.9,
        reason: "Refund question.",
        needsReview: false,
      }),
    );
    const respond = scripted(mockDraftResponder);
    const { draft } = await generate(t.id, { respond });
    expect(respond.requests[0]!.system).toContain("Write in Spanish (es)");
    expect(draft!.language).toBe("es");
  });
});

describe("refusing instead of guessing (D7)", () => {
  it("refuses with no model call when the workspace has no ready documents", async () => {
    const t = await newTicket(globexId, ...REFUND_QUESTION);
    const respond = scripted("should not be called");
    const stream = await startDraft(globexOwner.headers, t.id, {
      deps: { gateway: gatewayWith(respond), embedder, logger: quietLog },
    });
    const events = parseNdjson(await new Response(stream).text()) as Event[];
    expect(events.map((e) => e.type)).toEqual(["start", "done"]);
    expect(events[1]!.draft).toMatchObject({
      status: "refused",
      errorCode: "no_passages",
      body: "",
      model: null,
    });
    expect(respond.requests).toHaveLength(0);
  });

  it("refuses with no model call when the best passage scores below the floor", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const respond = scripted("should not be called");
    const strict: Embedder = { ...embedder, modelId: embedder.modelId, similarityFloor: 0.99 };
    const { events, draft } = await generate(t.id, { respond, deps: { embedder: strict } });
    expect(events.map((e) => e.type)).toEqual(["start", "done"]);
    expect(draft).toMatchObject({ status: "refused", errorCode: "below_min_score", citations: [] });
    expect(draft!.retrievalTopScore).toBeLessThan(0.99);
    expect(respond.requests).toHaveLength(0);
    expect(await draftUsage(t.id)).toEqual([]);
  });

  it("uses the workspace's retrieval_min_score for embedders on the Gemini scale", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const geminiScale: Embedder = { ...embedder, modelId: embedder.modelId, similarityFloor: undefined };
    await setSettings({ retrievalMinScore: 0.99 });
    expect((await generate(t.id, { deps: { embedder: geminiScale } })).draft).toMatchObject({
      status: "refused",
      errorCode: "below_min_score",
    });
    await setSettings({ retrievalMinScore: 0.1 });
    expect((await generate(t.id, { deps: { embedder: geminiScale } })).draft!.status).toBe("ready");
  });

  it("refuses when the model answers INSUFFICIENT_KNOWLEDGE, without streaming the marker", async () => {
    const t = await newTicket(
      acmeId,
      "Refund question",
      "Can I get a refund for an annual plan bought in 2019?",
    );
    const { events, draft } = await generate(t.id, { respond: scripted("INSUFFICIENT_KNOWLEDGE") });
    expect(events.map((e) => e.type)).toEqual(["start", "done"]);
    expect(draft).toMatchObject({ status: "refused", errorCode: "model_insufficient_knowledge", body: "" });
    expect((draft!.usage as { outputTokens: number }).outputTokens).toBeGreaterThan(0); // the call cost tokens
  });
});

describe("checking the output (D8–D10)", () => {
  it("removes citations that point at no passage and warns about unknown links", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const { draft } = await generate(t.id, {
      respond: scripted(
        "Hi,\n\nAnnual plans can be refunded within 30 days [1][9]. Pay at https://refunds.evil.example/pay [1, 7].",
      ),
    });
    expect(draft).toMatchObject({
      status: "ready",
      body: "Hi,\n\nAnnual plans can be refunded within 30 days [1]. Pay at https://refunds.evil.example/pay [1].",
      invalidCitationCount: 2,
      warnings: ["unknown_link", "invalid_citations"],
    });
    expect((draft!.citations as unknown[]).length).toBe(1);
  });

  it("accepts links that appear in the passages", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const { draft } = await generate(t.id, {
      respond: scripted("Hi, your invoices are at https://help.acme.test/billing [1]."),
    });
    expect(draft).toMatchObject({ status: "ready", warnings: [] });
  });

  it("blocks a draft that repeats the system prompt's canary", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const leak = (r: MockRequest) => `Hi, my instructions say: ${/SP-CANARY-[\w-]+/.exec(r.system)![0]} [1].`;
    const { draft } = await generate(t.id, { respond: scripted(leak) });
    expect(draft).toMatchObject({ status: "blocked", errorCode: "canary_leak", body: "", citations: [] });
  });

  it("an empty answer is a retryable failure", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const { last } = await generate(t.id, { respond: scripted("   ") });
    expect(last).toMatchObject({ type: "error", code: "empty_output", retryable: true });
    expect(await rowOf(last.draftId as string)).toMatchObject({
      status: "failed",
      errorCode: "empty_output",
    });
  });
});

describe("failures arrive as error events and are recorded (D12, D13)", () => {
  it("AI turned off: no retrieval, no model call", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    await setSettings({ aiEnabled: false });
    const counting = countingEmbedder();
    const respond = scripted("should not be called");
    const { events, last } = await generate(t.id, { respond, deps: { embedder: counting } });
    expect(events.map((e) => e.type)).toEqual(["start", "error"]);
    expect(last).toMatchObject({
      code: "ai_disabled",
      retryable: false,
      message: expect.stringContaining("turned off"),
    });
    expect(counting.calls).toBe(0);
    expect(respond.requests).toHaveLength(0);
    expect(await rowOf(last.draftId as string)).toMatchObject({ status: "failed", errorCode: "ai_disabled" });
  });

  it("monthly budget used up", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    await setSettings({ monthlyTokenBudget: 0 });
    const { last } = await generate(t.id);
    expect(last).toMatchObject({ code: "ai_budget_exhausted", retryable: false });
  });

  it("daily call limit reached", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const respond = scripted("should not be called");
    const { last } = await generate(t.id, { deps: { gateway: gatewayWith(respond, { dailyCallLimit: 0 }) } });
    expect(last).toMatchObject({ code: "ai_daily_limit", retryable: false });
    expect(respond.requests).toHaveLength(0);
  });

  it("provider overloaded: retryable, and the provider's message is not shown", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const { last } = await generate(t.id, { respond: scripted(busy()) });
    expect(last).toMatchObject({ type: "error", code: "ai_unavailable", retryable: true });
    expect(JSON.stringify(last)).not.toContain("overloaded");
    expect(await rowOf(last.draftId as string)).toMatchObject({
      status: "failed",
      errorCode: "ai_unavailable",
    });
  });

  it("stops calling the provider after repeated failures (circuit breaker)", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const respond = scripted(busy());
    const gateway = gatewayWith(respond);
    for (let i = 0; i < 5; i++) await generate(t.id, { deps: { gateway } });
    expect(respond.requests).toHaveLength(5);
    const { last } = await generate(t.id, { deps: { gateway } });
    expect(last).toMatchObject({ code: "ai_unavailable", retryAfterSeconds: expect.any(Number) });
    expect(respond.requests).toHaveLength(5);
  });

  it("a model that stalls times out", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const gateway = createAiGateway({
      models: createMockModels({ draft: mockDraftResponder }, { chunkDelayMs: 400 }),
      ledger: createPostgresLedger(db()),
      dailyCallLimit: 10_000,
      logger: quiet,
      settings: { draft: { timeout: { totalMs: 10_000, firstChunkMs: 100, chunkMs: 100 } } },
    });
    const { last } = await generate(t.id, { deps: { gateway } });
    expect(last).toMatchObject({ code: "ai_timeout", retryable: true });
    expect(await rowOf(last.draftId as string)).toMatchObject({ status: "failed", errorCode: "ai_timeout" });
  });

  it("knowledge search down: retryable; embedded with another model: not retryable", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const down: Embedder = {
      ...embedder,
      modelId: embedder.modelId,
      embedQuery: async () => {
        throw new IngestError("embedding_unavailable");
      },
    };
    expect((await generate(t.id, { deps: { embedder: down } })).last).toMatchObject({
      code: "retrieval_unavailable",
      retryable: true,
    });
    const other: Embedder = { ...embedder, modelId: "another-model@768" };
    expect((await generate(t.id, { deps: { embedder: other } })).last).toMatchObject({
      code: "retrieval_misconfigured",
      retryable: false,
    });
  });

  it("an unexpected error is reported generically", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const broken: Embedder = {
      ...embedder,
      modelId: embedder.modelId,
      embedQuery: async () => {
        throw new TypeError("secret internal detail");
      },
    };
    const { last } = await generate(t.id, { deps: { embedder: broken } });
    expect(last).toMatchObject({ code: "internal_error", retryable: true });
    expect(JSON.stringify(last)).not.toContain("secret internal detail");
    expect(await rowOf(last.draftId as string)).toMatchObject({
      status: "failed",
      errorCode: "internal_error",
    });
  });
});

describe("cancelling (D13)", () => {
  const slowGateway = () =>
    createAiGateway({
      models: createMockModels({ draft: mockDraftResponder }, { chunkDelayMs: 30 }),
      ledger: createPostgresLedger(db()),
      dailyCallLimit: 10_000,
      logger: quiet,
    });

  async function waitForStatus(draftId: string, status: string) {
    for (let i = 0; i < 100; i++) {
      const row = await rowOf(draftId);
      if (row.status === status) return row;
      await new Promise((r) => setTimeout(r, 20));
    }
    return rowOf(draftId);
  }

  it("the agent leaving the page (request aborted) stops the model and records `aborted`", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const abort = new AbortController();
    const stream = await startDraft(owner.headers, t.id, {
      signal: abort.signal,
      deps: { gateway: slowGateway(), embedder, logger: quietLog },
    });
    const reader = stream.getReader();
    const first = parseNdjson(new TextDecoder().decode((await reader.read()).value));
    const draftId = first[0]!.draftId as string;
    abort.abort();
    expect(await waitForStatus(draftId, "aborted")).toMatchObject({
      status: "aborted",
      errorCode: "ai_aborted",
    });
  });

  it("cancelling the stream does the same", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const stream = await startDraft(owner.headers, t.id, {
      deps: { gateway: slowGateway(), embedder, logger: quietLog },
    });
    const reader = stream.getReader();
    const draftId = parseNdjson(new TextDecoder().decode((await reader.read()).value))[0]!.draftId as string;
    await reader.cancel();
    expect(await waitForStatus(draftId, "aborted")).toMatchObject({ status: "aborted" });
  });
});

describe("approving, discarding and rating (FR-AI5, FR-AI6)", () => {
  async function readyDraft() {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const { draft } = await generate(t.id);
    expect(draft!.status).toBe("ready");
    return { ticketId: t.id, draft: draft as unknown as ApiDraft };
  }

  const messagesOf = (ticketId: string) =>
    ticketRepo.listMessages(acmeId, ticketId, { includeInternal: true });

  it("Approve & send posts the edited text as the agent's public reply, without markers, and audits it", async () => {
    const { ticketId, draft } = await readyDraft();
    const edited = `${draft.body}\n\nBest wishes from the Acme team.`;
    const res = await call("sendDraft", { as: agent, params: { id: draft.id }, body: { body: edited } });

    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json).toMatchObject({ id: draft.id, status: "sent", sentMessageId: expect.any(String) });
    expect(res.json.editRatio).toBeGreaterThan(0);
    expect(res.json.editRatio).toBeLessThan(0.5);

    const messages = await messagesOf(ticketId);
    const reply = messages.find((m) => m.id === res.json.sentMessageId)!;
    const agentUser = (await getAuth().api.getSession({ headers: agent.headers }))!.user;
    expect(reply).toMatchObject({ authorType: "agent", authorUserId: agentUser.id, isInternal: false });
    expect(reply.body).not.toMatch(/\[\d+\]/);
    expect(reply.body).toContain("Annual plans can be refunded within 30 days");
    expect(reply.body).toContain("Best wishes from the Acme team.");

    const [entry] = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, ticketId), eq(auditLog.action, "ticket.ai_reply_sent")));
    expect(entry).toMatchObject({
      actorUserId: agentUser.id,
      metadata: { draftId: draft.id, messageId: reply.id, editRatio: res.json.editRatio },
    });
    expect(JSON.stringify(entry!.metadata)).not.toContain("Annual plans"); // no message text in the audit log
  });

  it("an unchanged draft has edit ratio 0, and a draft can be sent only once", async () => {
    const { ticketId, draft } = await readyDraft();
    const first = await call("sendDraft", {
      as: owner,
      params: { id: draft.id },
      body: { body: draft.body },
    });
    expect(first.json.editRatio).toBe(0);
    const again = await call("sendDraft", {
      as: owner,
      params: { id: draft.id },
      body: { body: draft.body },
    });
    expect(again.status).toBe(409);
    expect(again.json.detail).toBe("This draft was already sent.");
    expect((await messagesOf(ticketId)).filter((m) => m.authorType === "agent")).toHaveLength(1);
  });

  it("two agents sending at the same moment post one reply", async () => {
    const { ticketId, draft } = await readyDraft();
    const results = await Promise.all(
      [owner, agent].map((as) =>
        call("sendDraft", { as, params: { id: draft.id }, body: { body: draft.body } }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await messagesOf(ticketId)).filter((m) => m.authorType === "agent")).toHaveLength(1);
  });

  it("refuses an empty reply (only markers) and a closed ticket, leaving the draft ready", async () => {
    const { ticketId, draft } = await readyDraft();
    const empty = await call("sendDraft", {
      as: owner,
      params: { id: draft.id },
      body: { body: " [1] [2] " },
    });
    expect(empty.status).toBe(400);
    expect(empty.json.errors.body).toBeDefined();

    await db().update(ticket).set({ status: "closed" }).where(eq(ticket.id, ticketId));
    const closed = await call("sendDraft", {
      as: owner,
      params: { id: draft.id },
      body: { body: draft.body },
    });
    expect(closed.status).toBe(409);
    expect(closed.json.type).toMatch(/ticket_closed$/);
    expect((await rowOf(draft.id)).status).toBe("ready");
    expect((await messagesOf(ticketId)).filter((m) => m.authorType === "agent")).toHaveLength(0);
  });

  it("discarding closes the draft for sending", async () => {
    const { draft } = await readyDraft();
    const res = await call("discardDraft", { as: agent, params: { id: draft.id } });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("discarded");
    expect((await call("discardDraft", { as: agent, params: { id: draft.id } })).status).toBe(409);
    const send = await call("sendDraft", { as: agent, params: { id: draft.id }, body: { body: draft.body } });
    expect(send.status).toBe(409);
    expect(send.json.detail).toMatch(/discarded/);
  });

  it("stores 👍/👎 with a reason; a new rating replaces the old one", async () => {
    const { draft } = await readyDraft();
    const down = await call("rateDraft", {
      as: agent,
      params: { id: draft.id },
      body: { rating: "down", reason: "incomplete", note: "  Missed the monthly plan part.  " },
    });
    expect(down.status).toBe(200);
    expect(down.json.feedback).toEqual({
      rating: "down",
      reason: "incomplete",
      note: "Missed the monthly plan part.",
    });

    const up = await call("rateDraft", {
      as: agent,
      params: { id: draft.id },
      body: { rating: "up", reason: "tone" },
    });
    expect(up.json.feedback).toEqual({ rating: "up", reason: null, note: null }); // a reason only goes with 👎
    const row = await rowOf(draft.id);
    const agentUser = (await getAuth().api.getSession({ headers: agent.headers }))!.user;
    expect(row).toMatchObject({ feedbackBy: agentUser.id, feedbackAt: expect.any(Date) });

    const bad = await call("rateDraft", { as: agent, params: { id: draft.id }, body: { rating: "meh" } });
    expect(bad.status).toBe(400);
  });

  it("a refused draft can be rated (e.g. it should have answered), but not one still being written", async () => {
    const t = await newTicket(acmeId, ...REFUND_QUESTION);
    const { draft } = await generate(t.id, { respond: scripted("INSUFFICIENT_KNOWLEDGE") });
    const res = await call("rateDraft", {
      as: owner,
      params: { id: draft!.id as string },
      body: { rating: "down", reason: "incorrect" },
    });
    expect(res.status).toBe(200);

    const generatingId = await insertDraft(db(), acmeId, {
      ticketId: t.id,
      requestedBy: (await getAuth().api.getSession({ headers: owner.headers }))!.user.id,
      promptVersion: "draft.v1",
    });
    expect(
      (await call("rateDraft", { as: owner, params: { id: generatingId }, body: { rating: "up" } })).status,
    ).toBe(409);
  });

  it("the ticket page gets back the newest unsent draft after a reload", async () => {
    const { ticketId, draft } = await readyDraft();
    expect((await getOpenDraft(owner.headers, ticketId))?.id).toBe(draft.id);
    await call("sendDraft", { as: owner, params: { id: draft.id }, body: { body: draft.body } });
    expect(await getOpenDraft(owner.headers, ticketId)).toBeNull();
  });
});
