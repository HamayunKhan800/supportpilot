import { APICallError } from "ai";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createAiGateway, createPostgresLedger, type AiGatewayOptions } from "@/server/modules/ai/gateway";
import type { MockResponder } from "@/server/modules/ai/mock-model";
import { createMockModels } from "@/server/modules/ai/models";
import { mockDraftResponder } from "@/server/modules/drafts/mock-responder";
import { createMockEmbedder, type Embedder } from "@/server/modules/kb/embedder";
import { mockTriageResponder } from "@/server/modules/triage/mock-responder";
import { getDb } from "@/server/platform/db/client";
import { aiDailyCalls, evalItem, evalRun, organization } from "@/server/platform/db/schema";
import { stopWebBoss } from "@/server/platform/jobs/boss";

import { meterGateway, spreadPick } from "../../scripts/lib/ai-smoke";
import { createEvalAi } from "../../scripts/lib/eval-ai";
import { runConfig, runEval, type EvalDataset, type RunEvalOptions } from "../../scripts/lib/eval-runner";
import { loadInjectionCases } from "../../scripts/lib/injection-cases";
import { loadCorpus, loadQuestions, loadUnanswerable } from "../../scripts/lib/kb-corpus";
import { loadTriageSet } from "../../scripts/lib/triage-set";

/**
 * The M6 evaluation runner (scripts/eval.ts) with the mock models: every item saved as it is
 * measured, resumable after a stop, and never mixing results from different data or settings.
 */

const quiet = { warn: () => {} } as unknown as AiGatewayOptions["logger"];
const db = () => getDb().db;

const dataset: EvalDataset = {
  corpus: loadCorpus(),
  triage: loadTriageSet().slice(0, 3),
  answerable: spreadPick(loadQuestions(), 2),
  unanswerable: spreadPick(loadUnanswerable(), 1),
  injection: loadInjectionCases().filter((c) => ["D01", "I07"].includes(c.id)),
};
// 2 searches + 3 triage + 3 drafts + 2 injection cases.
const PLANNED = 10;

function metered(maxCalls = 100, triage: MockResponder = mockTriageResponder) {
  return meterGateway(
    createAiGateway({
      models: createMockModels({ draft: mockDraftResponder, triage }),
      ledger: createPostgresLedger(db()),
      dailyCallLimit: 100_000,
      logger: quiet,
    }),
    { gapMs: 0, maxCalls, redact: (s) => s.replaceAll("SECRET-KEY-123", "[REDACTED]") },
  );
}

const embedder = createMockEmbedder();
const config = runConfig({
  provider: "mock",
  models: { triage: "mock-llm", draft: "mock-llm", draftFallback: null },
  embedder,
});

function options(m: ReturnType<typeof metered>, over: Partial<RunEvalOptions> = {}): RunEvalOptions {
  return {
    provider: "mock",
    metered: m,
    embedder,
    dataset,
    config,
    requestsSent: () => m.calls,
    redact: (s) => s.replaceAll("SECRET-KEY-123", "[REDACTED]"),
    log: () => {},
    ...over,
  };
}

const itemsOf = (runId: string) => db().select().from(evalItem).where(eq(evalItem.runId, runId));

afterAll(async () => {
  await stopWebBoss();
});

// Each test starts with no runs, so "resume the newest unfinished run" sees only its own
// (the crash test leaves a stopped run behind on purpose). Items go with their run.
beforeEach(async () => {
  await db().delete(evalRun);
});

describe("evaluation runner", () => {
  it("measures every suite, saves each item, tags the run, and deletes its workspace", async () => {
    const orgsBefore = await db().select({ id: organization.id }).from(organization);
    const m = metered();
    const result = await runEval(options(m));

    expect(result.run.status).toBe("completed");
    expect(result.run.finishedAt).not.toBeNull();
    expect(result.run.stopReason).toBeNull();
    expect(result.run.datasetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.run.config).toMatchObject({
      promptVersions: { triage: "triage.v1", draft: "draft.v1" },
      models: { triage: "mock-llm", draft: "mock-llm" },
      topK: 5,
    });
    expect(result.run.calls).toBe(m.calls);
    expect(result).toMatchObject({ resumed: false, skipped: 0, measured: PLANNED, planned: PLANNED });

    const rows = await itemsOf(result.run.id);
    expect(rows.map((r) => `${r.suite}:${r.itemKey}`).sort()).toEqual(
      [
        ...dataset.answerable.map((q) => `retrieval:${q.id}`),
        ...dataset.triage.map((t) => `triage:${t.key}`),
        ...dataset.answerable.map((q) => `draft:${q.id}`),
        ...dataset.unanswerable.map((q) => `draft:${q.id}`),
        "injection:D01",
        "injection:I07",
      ].sort(),
    );
    expect(rows.every((r) => !r.failed)).toBe(true);
    // A triage item passes when the category is right, and stores what the model answered.
    const triage = rows.find((r) => r.itemKey === dataset.triage[0]!.key)!;
    const tr = triage.result as { categoryCorrect: boolean; got: { sentiment: string | null } };
    expect(triage.passed).toBe(tr.categoryCorrect);
    expect(tr.got.sentiment).toMatch(/^(negative|neutral|positive)$/);

    expect(result.summary.items).toEqual({ retrieval: 2, triage: 3, draft: 3, injection: 2 });
    expect(result.summary.triage.category.n).toBe(3);
    expect(result.summary.drafts.refusalRecall.n).toBe(1);
    const [stored] = await db().select().from(evalRun).where(eq(evalRun.id, result.run.id));
    expect(stored!.summary).toEqual(JSON.parse(JSON.stringify(result.summary)));

    const orgsAfter = await db().select({ id: organization.id }).from(organization);
    expect(orgsAfter.length).toBe(orgsBefore.length);
  });

  it("stops at the call budget without saving the item it cut off, and resume measures only the rest", async () => {
    const first = metered(2);
    const stopped = await runEval(options(first));
    expect(stopped.run.status).toBe("stopped");
    expect(stopped.run.stopReason).toBe("call budget of 2 reached");
    expect(stopped.run.finishedAt).toBeNull();
    // The searches make no model calls; two triage calls fit; the third ticket is not saved.
    expect((await itemsOf(stopped.run.id)).map((r) => r.suite).sort()).toEqual([
      "retrieval",
      "retrieval",
      "triage",
      "triage",
    ]);

    const second = metered();
    const resumed = await runEval(options(second, { resume: true }));
    expect(resumed.run.id).toBe(stopped.run.id);
    expect(resumed).toMatchObject({ resumed: true, skipped: 4, measured: PLANNED - 4 });
    expect(resumed.run.status).toBe("completed");
    expect(resumed.run.calls).toBe(first.calls + second.calls);
    expect(await itemsOf(stopped.run.id)).toHaveLength(PLANNED);

    await expect(runEval(options(metered(), { resume: true }))).rejects.toThrow(
      "There is no unfinished mock run to resume.",
    );
    await expect(runEval(options(metered(), { resume: stopped.run.id }))).rejects.toThrow(
      /already completed/,
    );
  });

  it("refuses to resume when the datasets or the settings changed", async () => {
    const stopped = await runEval(options(metered(0)));
    expect(stopped.run.status).toBe("stopped");

    const changedData: EvalDataset = {
      ...dataset,
      triage: dataset.triage.map((t, i) => (i === 0 ? { ...t, message: `${t.message} (edited)` } : t)),
    };
    await expect(runEval(options(metered(), { resume: true, dataset: changedData }))).rejects.toThrow(
      /datasets changed/,
    );
    await expect(
      runEval(
        options(metered(), { resume: true, config: { ...config, promptVersions: { triage: "triage.v2" } } }),
      ),
    ).rejects.toThrow(/prompts, models or retrieval settings changed/);
    await expect(runEval(options(metered(), { resume: true, provider: "gemini" }))).rejects.toThrow(
      "There is no unfinished gemini run to resume.",
    );

    // Finish it, so the next test starts without an unfinished mock run.
    expect((await runEval(options(metered(), { resume: stopped.run.id }))).run.status).toBe("completed");
  });

  it("counts a provider failure apart from wrong answers, and --retry-failed measures it again", async () => {
    const failingKey = dataset.triage[1]!.key;
    let failNext = true;
    const flaky = metered(100, (request) => {
      // Fail one ticket's triage once with a 500, the way an overloaded model does.
      if (failNext && request.prompt.includes(dataset.triage[1]!.subject)) {
        failNext = false;
        throw new APICallError({
          message: "Internal error for key SECRET-KEY-123",
          url: "https://example.test",
          requestBodyValues: {},
          statusCode: 500,
        });
      }
      return mockTriageResponder(request);
    });
    const first = await runEval(options(flaky));
    expect(first.run.status).toBe("stopped");
    expect(first.run.stopReason).toMatch(
      /1 item\(s\) got no answer from the provider; resume with --retry-failed/,
    );
    const failed = (await itemsOf(first.run.id)).find((r) => r.itemKey === failingKey)!;
    expect(failed).toMatchObject({ failed: true, passed: false });
    expect(JSON.stringify(failed.result)).toContain("[REDACTED]");
    expect(JSON.stringify(failed.result)).not.toContain("SECRET-KEY-123");
    // Left out of the quality rates, reported as an error rate instead.
    expect(first.summary.triage.errors).toMatchObject({ successes: 1, n: 3 });
    expect(first.summary.triage.category.n).toBe(2);

    // Resuming without --retry-failed keeps the failure; with it, the item is measured again.
    const kept = await runEval(options(metered(), { resume: true }));
    expect(kept).toMatchObject({ measured: 0, skipped: PLANNED });
    expect(kept.run.status).toBe("stopped");
    const retried = await runEval(options(metered(), { resume: true, retryFailed: true }));
    expect(retried).toMatchObject({ measured: 1 });
    expect(retried.run.status).toBe("completed");
    expect(retried.summary.triage.errors.successes).toBe(0);
    expect(retried.summary.triage.category.n).toBe(3);
  });

  it("ends the session as stopped when something breaks, with the key removed from the reason", async () => {
    const broken: Embedder = {
      modelId: embedder.modelId,
      ...(embedder.similarityFloor !== undefined ? { similarityFloor: embedder.similarityFloor } : {}),
      embedDocuments: (items, signal) => embedder.embedDocuments(items, signal),
      embedQuery: () => Promise.reject(new Error("Embedding failed for key SECRET-KEY-123")),
    };
    await expect(runEval(options(metered(), { embedder: broken }))).rejects.toThrow(/Embedding failed/);
    const [run] = await db()
      .select()
      .from(evalRun)
      .where(eq(evalRun.provider, "mock"))
      .orderBy(evalRun.startedAt)
      .then((rows) => rows.slice(-1));
    expect(run!.status).toBe("stopped");
    expect(run!.stopReason).toBe("error: Embedding failed for key [REDACTED]");
    expect(await itemsOf(run!.id)).toHaveLength(0);
  });

  it("never uses the deployment's daily AI allowance: the run's own cap counts its calls (finding #108)", async () => {
    const totalCalls = async () =>
      (await db().select({ calls: aiDailyCalls.calls }).from(aiDailyCalls)).reduce((n, r) => n + r.calls, 0);
    const before = await totalCalls();
    const ai = createEvalAi({ provider: "mock", maxCalls: 3, gapMs: 0, cacheDir: "eval/cache" });
    const result = await runEval({
      provider: "mock",
      metered: ai.metered,
      embedder: ai.embedder,
      dataset,
      config: runConfig({ provider: "mock", models: ai.models, embedder: ai.embedder }),
      requestsSent: ai.requestsSent,
      log: () => {},
    });
    expect(ai.requestsSent()).toBe(3);
    expect(result.run.calls).toBe(3);
    expect(result.run.stopReason).toBe("call budget of 3 reached");
    expect(await totalCalls()).toBe(before);
  });
});
