import { createHash } from "node:crypto";

import { DRAFT_PROMPT_VERSION } from "../../src/server/modules/drafts/prompt";
import type { EvalProvider, EvalSuite } from "../../src/server/modules/eval/constants";
import * as evalRepo from "../../src/server/modules/eval/repository";
import { DEFAULT_CHUNK_OPTIONS } from "../../src/server/modules/kb/chunker";
import type { Embedder } from "../../src/server/modules/kb/embedder";
import { DEFAULT_RETRIEVAL_MIN_SCORE, RETRIEVAL_TOP_K } from "../../src/server/modules/kb/retrieval";
import { hybridSearch } from "../../src/server/modules/kb/service";
import {
  TRIAGE_PROMPT_VERSION,
  TRIAGE_PROMPT_VERSIONS,
  type TriagePromptVersion,
} from "../../src/server/modules/triage/prompt";
import { createDefaultWorkspaceSettings } from "../../src/server/platform/auth/workspace-settings";
import { getDb } from "../../src/server/platform/db/client";
import { scoreRanking } from "../../src/server/modules/eval/retrieval-metrics";

import {
  draftOne,
  ingestPoison,
  injectionOne,
  triageOne,
  type DraftItemInput,
  type ItemContext,
  type MeteredGateway,
} from "./ai-smoke";
import { type EvalSummary, type RetrievalResult, type SavedItem, summarizeEval } from "./eval-summary";
import { loadPoisonArticle, type InjectionCase } from "./injection-cases";
import type { CorpusArticle, EvalQuestion, UnanswerableQuestion } from "./kb-corpus";
import { setUpEvalWorkspace } from "./retrieval-eval";
import type { TriageSetItem } from "./triage-set";

/**
 * The M6 evaluation runner (plan D3, D4): one pass over every dataset through the app's real
 * code paths (the app's search, triage job and draft pipeline), with each item saved to the
 * database as soon as it is measured. A run that stops early (call budget, a 429, the
 * provider failing) can be resumed later; it then measures only what is missing. A run is
 * tied to the exact dataset and settings by two hashes, so a resumed run never mixes results
 * from different prompts, models or data.
 */

export interface EvalDataset {
  corpus: readonly CorpusArticle[];
  triage: readonly TriageSetItem[];
  answerable: readonly EvalQuestion[];
  unanswerable: readonly UnanswerableQuestion[];
  injection: readonly InjectionCase[];
}

/** SHA-256 of JSON with object keys sorted, so the hash does not depend on key order. */
export function stableHash(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, canonical(x)]),
      );
    }
    return v;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

/** Everything a result depends on in the data: texts, labels, help articles, poisoned articles. */
export function datasetHash(d: EvalDataset): string {
  const poison = [...new Set(d.injection.flatMap((c) => (c.poison ? [c.poison] : [])))].sort();
  return stableHash({
    corpus: d.corpus.map((a) => ({ file: a.file, sha256: a.sha256 })),
    triage: d.triage.map((t) => ({
      key: t.key,
      subject: t.subject,
      message: t.message,
      expected: t.expected,
    })),
    answerable: d.answerable,
    unanswerable: d.unanswerable,
    injection: d.injection,
    poison: poison.map((file) => ({ file, sha256: loadPoisonArticle(file).sha256 })),
  });
}

/** The settings a run is tagged with: prompt versions, models and retrieval settings. */
export function runConfig(options: {
  provider: EvalProvider;
  models: { triage: string; draft: string; draftFallback: string | null };
  embedder: Embedder;
  /** The triage prompt to measure (`--triage-prompt`); the app's own by default. */
  triagePrompt?: TriagePromptVersion;
}): Record<string, unknown> {
  return {
    provider: options.provider,
    promptVersions: { triage: options.triagePrompt ?? TRIAGE_PROMPT_VERSION, draft: DRAFT_PROMPT_VERSION },
    models: options.models,
    embeddingModel: options.embedder.modelId,
    chunk: DEFAULT_CHUNK_OPTIONS,
    topK: RETRIEVAL_TOP_K,
    // The draft pipeline's refusal threshold: the embedder's own floor, or the workspace default.
    retrievalMinScore: options.embedder.similarityFloor ?? DEFAULT_RETRIEVAL_MIN_SCORE,
  };
}

/**
 * The triage prompt a run measures, read from its settings: the one place it is recorded, and the
 * one that is hashed, so the stored label and the prompt actually used cannot differ.
 */
export function triagePromptOf(config: Record<string, unknown>): TriagePromptVersion {
  const value = (config.promptVersions as { triage?: unknown } | undefined)?.triage;
  if (value === undefined) return TRIAGE_PROMPT_VERSION;
  if (!TRIAGE_PROMPT_VERSIONS.includes(value as TriagePromptVersion)) {
    throw new Error(`Unknown triage prompt ${JSON.stringify(value)}.`);
  }
  return value as TriagePromptVersion;
}

export interface RunEvalOptions {
  provider: EvalProvider;
  metered: MeteredGateway;
  embedder: Embedder;
  dataset: EvalDataset;
  config: Record<string, unknown>;
  /** Continue the newest unfinished run of this provider (true) or a given run (its id). */
  resume?: boolean | string;
  /** On resume, measure again the items that failed for technical reasons. */
  retryFailed?: boolean;
  /** Provider requests sent in this session (counted where the app counts them). */
  requestsSent: () => number;
  /** Applied to error text before it is stored (removes the API key). */
  redact?: (text: string) => string;
  log: (line: string) => void;
}

export interface RunEvalResult {
  run: evalRepo.EvalRunRow;
  resumed: boolean;
  /** Items already measured before this session. */
  skipped: number;
  /** Items measured in this session. */
  measured: number;
  planned: number;
  items: SavedItem[];
  summary: EvalSummary;
}

const itemId = (suite: EvalSuite, key: string) => `${suite}:${key}`;

/** Items a full run measures, in order. */
export function plannedItems(d: EvalDataset): { suite: EvalSuite; key: string }[] {
  return [
    ...d.answerable.map((q) => ({ suite: "retrieval" as const, key: q.id })),
    ...d.triage.map((t) => ({ suite: "triage" as const, key: t.key })),
    ...d.answerable.map((q) => ({ suite: "draft" as const, key: q.id })),
    ...d.unanswerable.map((q) => ({ suite: "draft" as const, key: q.id })),
    ...d.injection.map((c) => ({ suite: "injection" as const, key: c.id })),
  ];
}

export const toSavedItem = (row: evalRepo.EvalItemRow): SavedItem =>
  ({ suite: row.suite, failed: row.failed, result: row.result }) as unknown as SavedItem;

async function openRun(options: RunEvalOptions, hashes: { datasetHash: string; configHash: string }) {
  const { db } = getDb();
  if (!options.resume) {
    const run = await evalRepo.createRun(db, {
      provider: options.provider,
      ...hashes,
      config: options.config,
    });
    return { run, resumed: false };
  }
  // Without an id: the newest unfinished run with these settings, so a v1 and a v2 run can be
  // continued side by side; failing that, the newest unfinished run, to explain what changed.
  const run =
    typeof options.resume === "string"
      ? await evalRepo.findRun(db, options.resume)
      : ((await evalRepo.findLatestUnfinishedRun(db, options.provider, hashes.configHash)) ??
        (await evalRepo.findLatestUnfinishedRun(db, options.provider)));
  if (!run) throw new Error(`There is no unfinished ${options.provider} run to resume.`);
  if (run.status === "completed") throw new Error(`Run ${run.id} has already completed.`);
  if (run.provider !== options.provider) {
    throw new Error(`Run ${run.id} used --provider ${run.provider}, not ${options.provider}.`);
  }
  if (run.datasetHash !== hashes.datasetHash) {
    throw new Error(
      `The datasets changed since run ${run.id} started, so its results would not be comparable. Start a new run.`,
    );
  }
  if (run.configHash !== hashes.configHash) {
    throw new Error(
      `The prompts, models or retrieval settings changed since run ${run.id} started. Start a new run.`,
    );
  }
  await evalRepo.reopenRun(db, run.id);
  if (options.retryFailed) {
    const n = await evalRepo.deleteFailedItems(db, run.id);
    options.log(`Measuring again ${n} item(s) that failed for technical reasons.`);
  }
  return { run, resumed: true };
}

export async function runEval(options: RunEvalOptions): Promise<RunEvalResult> {
  const { metered, embedder, dataset, log } = options;
  const redact = options.redact ?? ((s: string) => s);
  const { db } = getDb();
  const triagePrompt = triagePromptOf(options.config); // before opening a run: fail fast
  const hashes = { datasetHash: datasetHash(dataset), configHash: stableHash(options.config) };
  const { run, resumed } = await openRun(options, hashes);
  const done = new Set((await evalRepo.listItems(db, run.id)).map((r) => itemId(r.suite, r.itemKey)));
  const plan = plannedItems(dataset);
  const skipped = plan.filter((p) => done.has(itemId(p.suite, p.key))).length;
  log(
    `${resumed ? "Resuming" : "Started"} run ${run.id}: ${plan.length} items planned, ` +
      `${skipped} already measured.`,
  );
  let measured = 0;
  const save = async (suite: EvalSuite, key: string, passed: boolean, failed: boolean, result: object) => {
    await evalRepo.saveItem(db, run.id, {
      suite,
      itemKey: key,
      passed: passed && !failed,
      failed,
      result: result as Record<string, unknown>,
    });
    done.add(itemId(suite, key));
    measured++;
  };
  const todo = <T>(suite: EvalSuite, list: readonly T[], key: (t: T) => string) =>
    list.filter((t) => !done.has(itemId(suite, key(t))));

  let crash: unknown = null;
  if (skipped < plan.length) {
    log(`Setting up a temporary workspace with ${dataset.corpus.length} help articles…`);
    const ws = await setUpEvalWorkspace(DEFAULT_CHUNK_OPTIONS, {
      corpus: dataset.corpus,
      questions: dataset.answerable,
      embedder,
      log,
    });
    try {
      await createDefaultWorkspaceSettings(db, ws.workspaceId);
      const chunkArticle = new Map(ws.chunks.map((c) => [c.id, c.article]));
      const ctx: ItemContext = {
        workspaceId: ws.workspaceId,
        metered,
        embedder,
        titleOf: new Map(dataset.corpus.map((a) => [a.file, a.title])),
        triagePrompt,
      };

      // 1. Retrieval: the app's own search, scored against the passages that hold each answer.
      for (const q of todo("retrieval", dataset.answerable, (q) => q.id)) {
        const res = await hybridSearch(ws.workspaceId, q.question, embedder);
        const ids = res.results.map((r) => r.chunk.id);
        const score = scoreRanking(ids, ws.gold.get(q.id)!, RETRIEVAL_TOP_K);
        const result: RetrievalResult = {
          id: q.id,
          firstGoldRank: score.firstGoldRank,
          retrieved: ids.slice(0, RETRIEVAL_TOP_K).map((id) => chunkArticle.get(id) ?? "?"),
          retrievalMs: res.timingsMs.retrieval,
        };
        await save("retrieval", q.id, score.hit, false, result);
      }
      log(`  retrieval: ${dataset.answerable.length} questions searched`);

      // 2. Triage. An item cut short by the stop (budget or 429) is not saved: it runs on resume.
      for (const t of todo("triage", dataset.triage, (t) => t.key)) {
        if (metered.stopReason) break;
        const r = await triageOne(ctx, t);
        const ok = r.status === "succeeded";
        if (!ok && metered.stopReason) break;
        await save("triage", t.key, r.categoryCorrect, !ok && r.providerErrors.length > 0, r);
        log(`  triage ${t.key}: ${r.got ? `${r.got.category}/${r.got.priority}` : r.status}`);
      }

      // 3. Drafts for answerable and unanswerable questions.
      const questions: DraftItemInput[] = [
        ...dataset.answerable.map((q) => ({
          id: q.id,
          set: "answerable" as const,
          question: q.question,
          gold: q.article,
        })),
        ...dataset.unanswerable.map((q) => ({
          id: q.id,
          set: "unanswerable" as const,
          question: q.question,
          gold: null,
        })),
      ];
      for (const q of todo("draft", questions, (q) => q.id)) {
        if (metered.stopReason) break;
        const r = await draftOne(ctx, q);
        if (r.status === "failed" && metered.stopReason) break;
        const passed =
          q.set === "answerable" ? r.status === "ready" && r.citesGold === true : r.status === "refused";
        await save("draft", q.id, passed, r.status === "failed" && r.providerErrors.length > 0, r);
        log(`  draft ${q.id} (${q.set}): ${r.status}${r.errorCode ? ` ${r.errorCode}` : ""}`);
      }

      // 4. Injection cases, after the drafts, because the poisoned articles join the knowledge base.
      const cases = todo("injection", dataset.injection, (c) => c.id);
      if (cases.length > 0 && !metered.stopReason) {
        const poison = await ingestPoison(ctx, dataset.injection);
        for (const c of cases) {
          if (metered.stopReason) break;
          const r = await injectionOne(ctx, c, poison);
          const failed = r.outcome.status === "failed";
          if (failed && metered.stopReason) break;
          await save("injection", c.id, !r.obeyed, failed && r.providerErrors.length > 0, r);
          log(`  injection ${c.id}: ${r.obeyed ? `OBEYED (${r.signs.join(", ")})` : "resisted"}`);
        }
      }
    } catch (err) {
      crash = err;
    } finally {
      await ws.remove();
    }
  }

  const items = (await evalRepo.listItems(db, run.id)).map(toSavedItem);
  const summary = summarizeEval(items);
  const allMeasured = plan.every((p) => done.has(itemId(p.suite, p.key)));
  const technicalFailures = items.filter((i) => i.failed).length;
  // A run with provider failures is not complete: resuming with --retry-failed measures them again.
  const complete = !crash && allMeasured && technicalFailures === 0;
  const stopReason = complete
    ? null
    : crash
      ? redact(`error: ${crash instanceof Error ? crash.message : String(crash)}`).slice(0, 500)
      : (metered.stopReason ??
        (technicalFailures > 0
          ? `${technicalFailures} item(s) got no answer from the provider; resume with --retry-failed to measure them again`
          : "unknown"));
  await evalRepo.endSession(db, run.id, {
    status: complete ? "completed" : "stopped",
    stopReason,
    calls: options.requestsSent(),
    summary: summary as unknown as Record<string, unknown>,
  });
  if (crash) throw crash;
  return {
    run: (await evalRepo.findRun(db, run.id))!,
    resumed,
    skipped,
    measured,
    planned: plan.length,
    items,
    summary,
  };
}
