import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createAiGateway, createPostgresLedger, type AiGatewayOptions } from "@/server/modules/ai/gateway";
import { createMockModels } from "@/server/modules/ai/models";
import { mockDraftResponder } from "@/server/modules/drafts/mock-responder";
import { mockGraderResponder } from "@/server/modules/eval/grader-mock-responder";
import { createMockEmbedder } from "@/server/modules/kb/embedder";
import { mockTriageResponder } from "@/server/modules/triage/mock-responder";
import { getDb } from "@/server/platform/db/client";
import { evalItem, evalRun } from "@/server/platform/db/schema";
import { stopWebBoss } from "@/server/platform/jobs/boss";

import { meterGateway, spreadPick } from "../../scripts/lib/ai-smoke";
import { exportEvalState, importEvalState, type EvalStateFile } from "../../scripts/lib/eval-state";
import { runConfig, runEval, type EvalDataset } from "../../scripts/lib/eval-runner";
import { loadInjectionCases } from "../../scripts/lib/injection-cases";
import { loadCorpus, loadQuestions, loadUnanswerable } from "../../scripts/lib/kb-corpus";
import { loadTriageSet } from "../../scripts/lib/triage-set";

/**
 * Saving and loading evaluation runs (pnpm eval:state, M6 step 6): a run stopped in one
 * database continues in another, a file never rolls a run back, and a bad file writes nothing.
 */

const db = () => getDb().db;
const H1 = "a".repeat(64);
const H2 = "b".repeat(64);

afterAll(async () => {
  await stopWebBoss();
});

beforeEach(async () => {
  await db().delete(evalRun);
});

async function seedRun(
  provider: "gemini" | "mock",
  keys: string[],
  over: Partial<typeof evalRun.$inferInsert> = {},
) {
  const [run] = await db()
    .insert(evalRun)
    .values({
      provider,
      status: "stopped",
      datasetHash: H1,
      configHash: H2,
      config: { models: { draft: "gemini-3.8-flash" } },
      calls: keys.length,
      stopReason: "429 too many requests",
      ...over,
    })
    .returning();
  for (const key of keys) {
    await db()
      .insert(evalItem)
      .values({
        runId: run!.id,
        suite: "triage",
        itemKey: key,
        passed: true,
        result: { category: "billing" },
      });
  }
  return run!;
}

const allRows = async () => ({
  runs: await db().select().from(evalRun).orderBy(evalRun.startedAt),
  items: await db().select().from(evalItem).orderBy(evalItem.itemKey),
});

describe("eval state files", () => {
  it("saves one provider's runs with their items and loads them back unchanged", async () => {
    await seedRun("gemini", ["tri-001", "tri-002"]);
    await seedRun("mock", ["tri-003"]);
    const before = await allRows();

    const file = await exportEvalState(db(), "gemini");
    expect(file.runs).toHaveLength(1);
    expect(file.items.map((i) => i.itemKey).sort()).toEqual(["tri-001", "tri-002"]);
    expect(typeof file.runs[0]!.startedAt).toBe("string");

    await db().delete(evalRun);
    expect(await importEvalState(db(), JSON.parse(JSON.stringify(file)))).toEqual({
      runs: 1,
      runsUpdated: 0,
      items: 2,
    });
    const after = await allRows();
    expect(after.runs).toEqual(before.runs.filter((r) => r.provider === "gemini"));
    expect(after.items).toEqual(before.items.filter((i) => i.itemKey !== "tri-003"));

    // Loading the same file again changes nothing.
    expect(await importEvalState(db(), file)).toEqual({ runs: 0, runsUpdated: 0, items: 0 });
  });

  it("keeps the copy updated last, so an older file never rolls a run back", async () => {
    const run = await seedRun("gemini", ["tri-001"]);
    const older = await exportEvalState(db(), "gemini");

    // The run continues: one more item, then it completes.
    await db()
      .insert(evalItem)
      .values({ runId: run.id, suite: "triage", itemKey: "tri-002", passed: false, result: {} });
    await db()
      .update(evalRun)
      .set({ status: "completed", stopReason: null, finishedAt: new Date(), updatedAt: new Date(), calls: 2 })
      .where(eq(evalRun.id, run.id));
    const newer = await exportEvalState(db(), "gemini");

    // Another database that only has the older copy catches up from the newer file...
    await db().delete(evalRun);
    await importEvalState(db(), older);
    expect(await importEvalState(db(), newer)).toEqual({ runs: 0, runsUpdated: 1, items: 1 });
    // ...and loading the older file afterwards does not undo it.
    expect(await importEvalState(db(), older)).toEqual({ runs: 0, runsUpdated: 0, items: 0 });
    const [row] = await db().select().from(evalRun);
    expect(row).toMatchObject({ status: "completed", calls: 2, stopReason: null });
    expect(await db().select().from(evalItem)).toHaveLength(2);
  });

  it("never lets a file change what an existing run measures", async () => {
    await seedRun("gemini", ["tri-001"]);
    const file = await exportEvalState(db(), "gemini");
    const run = file.runs[0]!;
    const changed: EvalStateFile = {
      ...file,
      runs: [
        {
          ...run,
          configHash: "c".repeat(64),
          status: "completed",
          finishedAt: new Date().toISOString(),
          updatedAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    };
    expect(await importEvalState(db(), changed)).toEqual({ runs: 0, runsUpdated: 0, items: 0 });
    const [row] = await db().select().from(evalRun);
    expect(row).toMatchObject({ configHash: H2, status: "stopped" });
  });

  it("rejects a malformed file and writes nothing", async () => {
    await seedRun("gemini", ["tri-001"]);
    const good = await exportEvalState(db(), "gemini");
    await db().delete(evalRun);
    // A run that exists only in the database: a file may not attach items to it.
    const other = await seedRun("gemini", ["tri-009"], { configHash: "d".repeat(64) });
    const before = await allRows();
    const item = good.items[0]!;
    const bad: unknown[] = [
      { ...good, version: 2 },
      { ...good, extra: true },
      { ...good, items: [{ ...item, runId: "00000000-0000-4000-8000-000000000000" }] }, // no such run
      { ...good, items: [{ ...item, runId: other.id }] }, // a run that isn't in the file
      { ...good, items: [{ ...item, suite: "grade" }] },
      { ...good, items: [{ ...item, itemKey: "x'; drop table eval_run; --" }] },
      { ...good, runs: [{ ...good.runs[0]!, datasetHash: "not-a-hash" }] },
      { ...good, runs: [{ ...good.runs[0]!, startedAt: "yesterday" }] },
      // A valid run followed by an invalid item: checked before anything is written.
      { ...good, items: [item, { ...item, id: crypto.randomUUID(), itemKey: "tri-002", passed: "yes" }] },
    ];
    for (const input of bad) await expect(importEvalState(db(), input)).rejects.toThrow();
    expect(await allRows()).toEqual(before);
  });
});

describe("a run stopped in one database resumes in another", () => {
  const dataset: EvalDataset = {
    corpus: loadCorpus(),
    triage: loadTriageSet().slice(0, 3),
    answerable: spreadPick(loadQuestions(), 2),
    unanswerable: spreadPick(loadUnanswerable(), 1),
    injection: loadInjectionCases().filter((c) => c.id === "D01"),
  };
  const embedder = createMockEmbedder();
  const config = runConfig({
    provider: "mock",
    models: { triage: "mock-llm", draft: "mock-llm", draftFallback: null, grade: "mock-llm" },
    embedder,
  });
  const quiet = { warn: () => {} } as unknown as AiGatewayOptions["logger"];
  const metered = (maxCalls: number) =>
    meterGateway(
      createAiGateway({
        models: createMockModels({
          draft: mockDraftResponder,
          triage: mockTriageResponder,
          grade: mockGraderResponder,
        }),
        ledger: createPostgresLedger(db()),
        dailyCallLimit: 100_000,
        logger: quiet,
      }),
      { gapMs: 0, maxCalls, redact: (s) => s },
    );
  const run = (maxCalls: number, resume: boolean) => {
    const m = metered(maxCalls);
    return runEval({
      provider: "mock",
      metered: m,
      embedder,
      dataset,
      config,
      resume,
      requestsSent: () => m.calls,
      redact: (s) => s,
      log: () => {},
    });
  };

  it("continues from the saved items and finishes with the same plan", async () => {
    const first = await run(2, false); // the call budget stops it during triage
    expect(first.run.status).toBe("stopped");
    const file = JSON.parse(JSON.stringify(await exportEvalState(db(), "mock"))) as EvalStateFile;
    const savedKeys = file.items.map((i) => `${i.suite}:${i.itemKey}`);

    await db().delete(evalRun); // a new, empty database
    await importEvalState(db(), file);
    const second = await run(100, true);

    expect(second.run.id).toBe(first.run.id);
    expect(second.run.status).toBe("completed");
    expect(second).toMatchObject({
      resumed: true,
      skipped: savedKeys.length,
      planned: savedKeys.length + second.measured,
    });
    const rows = await db().select().from(evalItem).where(eq(evalItem.runId, first.run.id));
    expect(rows).toHaveLength(second.planned);
    // The saved results were kept, not measured again.
    for (const saved of file.items) {
      expect(rows.find((r) => r.id === saved.id)?.createdAt.toISOString()).toBe(saved.createdAt);
    }
  });
});
