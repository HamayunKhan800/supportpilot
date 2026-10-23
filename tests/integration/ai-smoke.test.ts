import { APICallError } from "ai";
import { afterAll, describe, expect, it } from "vitest";

import { createAiGateway, createPostgresLedger, type AiGatewayOptions } from "@/server/modules/ai/gateway";
import { createMockModels } from "@/server/modules/ai/models";
import { mockDraftResponder } from "@/server/modules/drafts/mock-responder";
import { createMockEmbedder } from "@/server/modules/kb/embedder";
import { mockTriageResponder } from "@/server/modules/triage/mock-responder";
import { getDb } from "@/server/platform/db/client";
import { organization } from "@/server/platform/db/schema";
import { stopWebBoss } from "@/server/platform/jobs/boss";

import { meterGateway, runAiSmoke, spreadPick } from "../../scripts/lib/ai-smoke";
import { loadInjectionCases } from "../../scripts/lib/injection-cases";
import { loadCorpus, loadQuestions, loadUnanswerable } from "../../scripts/lib/kb-corpus";

/**
 * The AI smoke-run harness (scripts/eval-ai-smoke.ts) with the mock model: it must produce a
 * complete report, clean up its workspace, and obey its safety stops (call budget, first
 * 429, no key in error messages) before it is ever pointed at Gemini.
 */

const quiet = { warn: () => {} } as unknown as AiGatewayOptions["logger"];
const db = () => getDb().db;

function mockGateway(over: Partial<Parameters<typeof createMockModels>[0]> = {}) {
  return createAiGateway({
    models: createMockModels({ draft: mockDraftResponder, triage: mockTriageResponder, ...over }),
    ledger: createPostgresLedger(db()),
    dailyCallLimit: 100_000,
    logger: quiet,
  });
}

const injection = loadInjectionCases().filter((c) => ["D01", "D09", "I07"].includes(c.id));
const corpus = loadCorpus();

afterAll(async () => {
  await stopWebBoss();
});

describe("AI smoke run", () => {
  it("measures triage, drafts and injection cases, then deletes its workspace", async () => {
    const before = await db().select({ id: organization.id }).from(organization);
    const metered = meterGateway(mockGateway(), { gapMs: 0, maxCalls: 20 });
    const progress: number[] = [];
    const report = await runAiSmoke({
      metered,
      embedder: createMockEmbedder(),
      corpus,
      triageKeys: ["nim-01", "nim-02"],
      answerable: spreadPick(loadQuestions(), 2),
      unanswerable: spreadPick(loadUnanswerable(), 1),
      injection,
      log: () => {},
      onProgress: (r) => progress.push(r.triage.length + r.drafts.length + r.injection.length),
    });

    expect(report.stopReason).toBeNull();
    expect(report.calls).toBe(8);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(report.models).toEqual({ triage: "mock-llm", draft: "mock-llm" });
    expect(report.triage.map((t) => [t.key, t.status, t.calls])).toEqual([
      ["nim-01", "succeeded", 1],
      ["nim-02", "succeeded", 1],
    ]);
    expect(report.triage[0]!.categoryCorrect).toBe(report.triage[0]!.got?.category === "billing");
    expect(report.drafts.map((d) => d.set)).toEqual(["answerable", "answerable", "unanswerable"]);
    expect(report.drafts[0]).toMatchObject({
      id: "q001",
      status: "ready",
      modelCalled: true,
      citesGold: true,
    });
    expect(report.drafts[0]!.modelText).toContain("[");
    expect(report.injection.map((i) => i.id)).toEqual(["D01", "D09", "I07"]);
    expect(report.injection.every((i) => i.reachedModel)).toBe(true);
    expect(report.injection.find((i) => i.id === "I07")).toMatchObject({ poisonShown: true });
    expect(report.summary.cost.calls).toBe(8);
    expect(report.summary.injection.cases).toBe(3);
    // Mock usage has a zero price, so cost is reported as zero, never missing.
    expect(report.summary.cost.estCostUsd).toBe(0);

    const after = await db().select({ id: organization.id }).from(organization);
    expect(after.length).toBe(before.length);
  }, 120_000);

  it("stops at the call budget, and at the first 429 without retrying", async () => {
    const budget = meterGateway(mockGateway(), { gapMs: 0, maxCalls: 2 });
    const report = await runAiSmoke({
      metered: budget,
      embedder: createMockEmbedder(),
      corpus,
      triageKeys: ["nim-01", "nim-02", "nim-03", "nim-04"],
      answerable: [],
      unanswerable: [],
      injection: [],
      log: () => {},
    });
    expect(budget.calls).toBe(2);
    expect(report.stopReason).toBe("call budget of 2 reached");
    expect(report.triage.length).toBe(3); // the third found the budget used up and stopped the run

    let attempts = 0;
    const tooMany = meterGateway(
      mockGateway({
        triage: () => {
          attempts++;
          throw new APICallError({
            message: "Resource exhausted for key SECRET-KEY-123",
            url: "https://example.test",
            requestBodyValues: {},
            statusCode: 429,
          });
        },
      }),
      { gapMs: 0, maxCalls: 50, redact: (s) => s.replaceAll("SECRET-KEY-123", "[REDACTED]") },
    );
    const stopped = await runAiSmoke({
      metered: tooMany,
      embedder: createMockEmbedder(),
      corpus,
      triageKeys: ["nim-01", "nim-02", "nim-03"],
      answerable: spreadPick(loadQuestions(), 2),
      unanswerable: [],
      injection,
      log: () => {},
    });
    expect(attempts).toBe(1);
    expect(stopped.stopReason).toMatch(/429/);
    expect(stopped.triage).toHaveLength(1);
    expect(stopped.drafts).toHaveLength(0);
    expect(stopped.triage[0]!.providerErrors).toEqual([
      { status: 429, message: "Resource exhausted for key [REDACTED]" },
    ]);
  }, 120_000);

  it("stops after three provider failures in a row (an overloaded model), and a success resets the count", async () => {
    let n = 0;
    const answers = [503, 0, 503, 503, 503, 0];
    const flaky = meterGateway(
      mockGateway({
        triage: (request) => {
          const status = answers[n++] ?? 0;
          if (status) {
            throw new APICallError({
              message: "This model is currently experiencing high demand.",
              url: "https://example.test",
              requestBodyValues: {},
              statusCode: status,
            });
          }
          return mockTriageResponder(request);
        },
      }),
      { gapMs: 0, maxCalls: 50 },
    );
    const report = await runAiSmoke({
      metered: flaky,
      embedder: createMockEmbedder(),
      corpus,
      triageKeys: ["nim-01", "nim-02", "nim-03", "nim-04", "nim-05", "nim-06"],
      answerable: [],
      unanswerable: [],
      injection: [],
      log: () => {},
    });
    expect(n).toBe(5);
    expect(report.stopReason).toBe("3 provider failures in a row");
    expect(report.triage.map((t) => t.status)).toEqual(["failed", "succeeded", "failed", "failed", "failed"]);
  }, 120_000);

  it("waits the configured gap between calls", async () => {
    let clock = 0;
    const waits: number[] = [];
    const metered = meterGateway(mockGateway(), {
      gapMs: 7000,
      maxCalls: 5,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    const ctx = { workspaceId: "00000000-0000-0000-0000-000000000000" };
    const request = { feature: "draft" as const, system: "s", prompt: "p", onDelta: () => {} };
    await metered.gateway.streamText(ctx, request).catch(() => {});
    clock += 1000;
    await metered.gateway.streamText(ctx, request).catch(() => {});
    expect(waits).toEqual([6000]);
    expect(metered.calls).toBe(2);
  });

  it("picks evenly spaced samples", () => {
    expect(spreadPick([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3)).toEqual([1, 4, 7]);
    expect(spreadPick([1, 2], 5)).toEqual([1, 2]);
    expect(spreadPick([1, 2], 0)).toEqual([]);
  });
});
