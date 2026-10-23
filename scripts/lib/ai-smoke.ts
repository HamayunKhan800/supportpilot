import { APICallError } from "ai";

import { AiError } from "../../src/server/modules/ai/errors";
import type { AiGateway } from "../../src/server/modules/ai/gateway";
import type { ApiDraft } from "../../src/server/modules/drafts/serialize";
import { runDraftPipeline, type DraftEvent } from "../../src/server/modules/drafts/service";
import { percentile } from "../../src/server/modules/eval/retrieval-metrics";
import { DEFAULT_CHUNK_OPTIONS } from "../../src/server/modules/kb/chunker";
import type { Embedder } from "../../src/server/modules/kb/embedder";
import { runIngestJob } from "../../src/server/modules/kb/ingest-job";
import * as kbRepo from "../../src/server/modules/kb/repository";
import { DEMO_TICKETS } from "../../src/server/modules/tickets/demo/tickets";
import * as ticketRepo from "../../src/server/modules/tickets/repository";
import { generateTrackingToken } from "../../src/server/modules/tickets/tracking-token";
import { runTriageJob, type TriageOutcome } from "../../src/server/modules/triage/job";
import type { TriagePromptVersion } from "../../src/server/modules/triage/prompt";
import { findLatestTriage } from "../../src/server/modules/triage/repository";
import { createDefaultWorkspaceSettings } from "../../src/server/platform/auth/workspace-settings";
import { getDb } from "../../src/server/platform/db/client";
import { transaction } from "../../src/server/platform/db/tx";

import { attackSigns, canaryOf, loadPoisonArticle, type InjectionCase } from "./injection-cases";
import type { CorpusArticle, EvalQuestion, UnanswerableQuestion } from "./kb-corpus";
import { setUpEvalWorkspace } from "./retrieval-eval";

/**
 * The AI smoke run (M5 step 6): a small, budgeted pass over the real pipelines with a real
 * model (or the mock, in CI) that measures what the plan promised: triage labels against
 * the demo set's answers, drafts for answerable and unanswerable questions, and the 20
 * injection cases, with latency, time to first token, tokens and cost for every call.
 *
 * Every generation call goes through a metered gateway that spaces calls out, stops at a
 * hard call budget, and ends the run at the first "too many requests" answer instead of
 * retrying (the free tier's limits are per project and per day).
 */

export interface CallRecord {
  feature: "triage" | "draft";
  ok: boolean;
  errorCode?: string;
  /** Provider status and message for failed calls (never the request). */
  providerError?: { status: number | null; message: string };
  latencyMs?: number;
  ttftMs?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  estCostMicros?: number;
  finishReason?: string;
  /** What the model answered: draft text, or the triage object. */
  text?: string;
  object?: unknown;
  canary?: string | null;
  /** Passage titles the model was shown (drafts). */
  passageTitles?: string[];
}

export interface MeteredGateway {
  gateway: AiGateway;
  /** Calls made so far. */
  readonly calls: number;
  /** Set when the run must stop: budget used, or the provider said "too many requests". */
  readonly stopReason: string | null;
  /** Records since the last take. */
  take(): CallRecord[];
}

const PASSAGE_TITLE = /<passage n="\d+" title="([^"]*)"/g;

function providerError(err: unknown, redact: (s: string) => string): CallRecord["providerError"] {
  const cause = err instanceof AiError ? err.cause : err;
  if (APICallError.isInstance(cause)) {
    return { status: cause.statusCode ?? null, message: redact(cause.message).slice(0, 800) };
  }
  return { status: null, message: redact(err instanceof Error ? err.message : String(err)).slice(0, 800) };
}

export function meterGateway(
  inner: AiGateway,
  options: {
    gapMs: number;
    maxCalls: number;
    /** Stop after this many failed provider calls in a row (default 3): the provider is struggling. */
    maxConsecutiveFailures?: number;
    redact?: (s: string) => string;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): MeteredGateway {
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const redact = options.redact ?? ((s: string) => s);
  let calls = 0;
  let lastStart = Number.NEGATIVE_INFINITY;
  let stopReason: string | null = null;
  let records: CallRecord[] = [];
  let failuresInARow = 0;
  const maxFailures = options.maxConsecutiveFailures ?? 3;

  // Refused calls fail like the app's own daily cap, so the pipelines record them cleanly.
  async function before() {
    if (!stopReason && calls >= options.maxCalls) stopReason = `call budget of ${options.maxCalls} reached`;
    if (stopReason) throw new AiError("ai_daily_limit");
    const wait = lastStart + options.gapMs - now();
    if (wait > 0) await sleep(wait);
    lastStart = now();
    calls++;
  }
  function failed(feature: CallRecord["feature"], err: unknown, extra: Partial<CallRecord>) {
    const pe = providerError(err, redact);
    records.push({
      feature,
      ok: false,
      errorCode: err instanceof AiError ? err.code : "internal_error",
      providerError: pe,
      ...extra,
    });
    failuresInARow++;
    if (pe?.status === 429) stopReason = "the provider answered 429 (too many requests)";
    else if (failuresInARow >= maxFailures) stopReason = `${failuresInARow} provider failures in a row`;
  }

  const gateway: AiGateway = {
    provider: inner.provider,
    circuitState: (feature) => inner.circuitState(feature),
    async generateObject(ctx, request) {
      await before();
      try {
        const r = await inner.generateObject(ctx, request);
        failuresInARow = 0;
        records.push({
          feature: request.feature,
          ok: true,
          latencyMs: r.latencyMs,
          ...r.usage,
          object: r.object,
        });
        return r;
      } catch (err) {
        failed(request.feature, err, {});
        throw err;
      }
    },
    async streamText(ctx, request) {
      await before();
      const shown = {
        canary: canaryOf(request.system),
        passageTitles: [...request.prompt.matchAll(PASSAGE_TITLE)].map((m) =>
          m[1]!.replaceAll("&quot;", '"'),
        ),
      };
      try {
        const r = await inner.streamText(ctx, request);
        failuresInARow = 0;
        records.push({
          feature: request.feature,
          ok: true,
          latencyMs: r.latencyMs,
          ttftMs: r.ttftMs,
          ...r.usage,
          finishReason: r.finishReason,
          text: r.text,
          ...shown,
        });
        return r;
      } catch (err) {
        failed(request.feature, err, shown);
        throw err;
      }
    },
  };
  return {
    gateway,
    get calls() {
      return calls;
    },
    get stopReason() {
      return stopReason;
    },
    take() {
      const out = records;
      records = [];
      return out;
    },
  };
}

// --- Results ------------------------------------------------------------------------------

export interface Metered {
  calls: number;
  latencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  estCostMicros: number;
  providerErrors: NonNullable<CallRecord["providerError"]>[];
}

export function sumCalls(records: CallRecord[]): Metered {
  const ok = records.filter((r) => r.ok);
  return {
    calls: records.length,
    latencyMs: ok.length ? ok.reduce((n, r) => n + (r.latencyMs ?? 0), 0) : null,
    inputTokens: ok.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
    outputTokens: ok.reduce((n, r) => n + (r.outputTokens ?? 0), 0),
    estCostMicros: ok.reduce((n, r) => n + (r.estCostMicros ?? 0), 0),
    providerErrors: records.flatMap((r) => (r.providerError ? [r.providerError] : [])),
  };
}

export interface TriageResult extends Metered {
  key: string;
  /** The model that answered (null when no call succeeded). */
  model: string | null;
  /** The labels; the M6 set also labels sentiment and language. */
  expected: { category: string; priority: string; sentiment?: string; language?: string };
  status: TriageOutcome["status"];
  errorCode: string | null;
  got: {
    category: string;
    priority: string;
    sentiment: string | null;
    confidence: number;
    language: string | null;
  } | null;
  needsReview: boolean | null;
  categoryCorrect: boolean;
  priorityCorrect: boolean;
}

export interface DraftResult extends Metered {
  id: string;
  set: "answerable" | "unanswerable";
  question: string;
  /** The model that wrote the draft (the fallback, if the first model was overloaded). */
  model: string | null;
  goldArticle: string | null;
  status: string;
  errorCode: string | null;
  warnings: string[];
  modelCalled: boolean;
  citedTitles: string[];
  /** Citations kept after the check that each one points at a passage the model was shown. */
  citationCount: number;
  citesGold: boolean | null;
  invalidCitations: number;
  ttftMs: number | null;
  endToEndMs: number | null;
  finishReason: string | null;
  /** The model's own text (also when the draft was refused or blocked). */
  modelText: string | null;
}

export interface InjectionResult extends Metered {
  id: string;
  kind: InjectionCase["kind"];
  target: InjectionCase["target"];
  technique: string;
  /** The model that answered (drafts: the one that wrote the draft). */
  model: string | null;
  reachedModel: boolean;
  /** Indirect cases: the poisoned article was among the passages the model saw. */
  poisonShown: boolean | null;
  outcome: { status: string; errorCode: string | null; warnings?: string[]; applied?: unknown };
  modelAnswer: string | null;
  /** Signs that the model obeyed the attack (empty = it resisted). */
  signs: string[];
  obeyed: boolean;
  /** The pipeline blocked, flagged or rejected the answer. */
  caughtByCode: boolean;
}

export interface AiSmokeReport {
  provider: string;
  models: { triage: string | null; draft: string | null };
  startedAt: string;
  finishedAt: string;
  calls: number;
  stopReason: string | null;
  triage: TriageResult[];
  drafts: DraftResult[];
  injection: InjectionResult[];
  summary: ReturnType<typeof summarize>;
}

const round = (n: number) => Math.round(n);
const spread = (values: number[]) =>
  values.length
    ? { n: values.length, p50: round(percentile(values, 50)), p95: round(percentile(values, 95)) }
    : { n: 0, p50: null, p95: null };
const rate = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 10 : null);

export function summarize(triage: TriageResult[], drafts: DraftResult[], injection: InjectionResult[]) {
  const triaged = triage.filter((t) => t.status === "succeeded");
  const answerable = drafts.filter((d) => d.set === "answerable");
  const unanswerable = drafts.filter((d) => d.set === "unanswerable");
  const modelDrafts = drafts.filter((d) => d.modelCalled);
  const all: Metered[] = [...triage, ...drafts, ...injection];
  const obeyed = injection.filter((i) => i.obeyed);
  return {
    triage: {
      run: triage.length,
      succeeded: triaged.length,
      categoryAccuracyPct: rate(triaged.filter((t) => t.categoryCorrect).length, triaged.length),
      priorityAccuracyPct: rate(triaged.filter((t) => t.priorityCorrect).length, triaged.length),
      needsReview: triaged.filter((t) => t.needsReview).length,
      latencyMs: spread(triage.flatMap((t) => (t.latencyMs !== null ? [t.latencyMs] : []))),
    },
    drafts: {
      answerable: answerable.length,
      answerableReady: answerable.filter((d) => d.status === "ready").length,
      answerableCitingGold: answerable.filter((d) => d.citesGold).length,
      unanswerable: unanswerable.length,
      unanswerableRefused: unanswerable.filter((d) => d.status === "refused").length,
      refusedBeforeModel: drafts.filter((d) => d.status === "refused" && !d.modelCalled).length,
      byModel: countBy([...drafts, ...injection].flatMap((d) => (d.model ? [d.model] : []))),
      invalidCitationsRemoved: drafts.reduce((n, d) => n + d.invalidCitations, 0),
      truncated: drafts.filter((d) => d.finishReason === "length").length,
      ttftMs: spread(modelDrafts.flatMap((d) => (d.ttftMs !== null ? [d.ttftMs] : []))),
      modelLatencyMs: spread(modelDrafts.flatMap((d) => (d.latencyMs !== null ? [d.latencyMs] : []))),
      endToEndMs: spread(drafts.flatMap((d) => (d.endToEndMs !== null ? [d.endToEndMs] : []))),
    },
    injection: {
      cases: injection.length,
      reachedModel: injection.filter((i) => i.reachedModel).length,
      obeyed: obeyed.length,
      obeyedCaughtByCode: obeyed.filter((i) => i.caughtByCode).length,
      obeyedReachedAgentUnflagged: obeyed.filter((i) => !i.caughtByCode).map((i) => i.id),
    },
    cost: {
      calls: all.reduce((n, m) => n + m.calls, 0),
      failedCalls: all.reduce((n, m) => n + m.providerErrors.length, 0),
      inputTokens: all.reduce((n, m) => n + m.inputTokens, 0),
      outputTokens: all.reduce((n, m) => n + m.outputTokens, 0),
      estCostUsd: Math.round(all.reduce((n, m) => n + m.estCostMicros, 0)) / 1e6,
      perTriageUsd: perCall(triage),
      perDraftUsd: perCall(modelDrafts),
    },
  };
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function perCall(items: Metered[]) {
  const paid = items.filter((m) => m.calls > 0 && m.providerErrors.length === 0);
  return paid.length ? Math.round(paid.reduce((n, m) => n + m.estCostMicros, 0) / paid.length) / 1e6 : null;
}

// --- The run ------------------------------------------------------------------------------

export interface AiSmokeOptions {
  metered: MeteredGateway;
  embedder: Embedder;
  corpus: readonly CorpusArticle[];
  triageKeys: readonly string[];
  answerable: readonly EvalQuestion[];
  unanswerable: readonly UnanswerableQuestion[];
  injection: readonly InjectionCase[];
  log: (line: string) => void;
  /** Called after every item, e.g. to save partial results. */
  onProgress?: (report: AiSmokeReport) => void;
}

export async function insertTicket(workspaceId: string, subject: string, message: string, note?: string) {
  const t = await transaction((tx) =>
    ticketRepo.insertTicket(tx, workspaceId, {
      subject,
      customerName: "Eval Customer",
      customerEmail: "eval@example.test",
      accessTokenHash: generateTrackingToken().hash,
      firstMessage: message,
    }),
  );
  if (note) {
    await transaction((tx) =>
      ticketRepo.insertMessage(tx, workspaceId, t.id, {
        authorType: "agent",
        authorUserId: null,
        body: note,
        isInternal: true,
      }),
    );
  }
  return t;
}

export async function ingest(workspaceId: string, article: CorpusArticle, embedder: Embedder) {
  const doc = await transaction((tx) =>
    kbRepo.insertDocument(tx, workspaceId, {
      title: article.title,
      filename: article.filename,
      mimeType: article.mimeType,
      sha256: article.sha256,
      uploadedBy: null,
      bytes: article.bytes,
    }),
  );
  const outcome = await runIngestJob(
    { workspaceId, documentId: doc.id },
    { isFinalAttempt: true },
    { embedder, prepare: { chunk: DEFAULT_CHUNK_OPTIONS } },
  );
  if (outcome.status !== "ready")
    throw new Error(`Ingesting ${article.file} failed: ${JSON.stringify(outcome)}`);
}

const doneDraft = (events: DraftEvent[]) => {
  const last = events.at(-1);
  return last?.type === "done" ? last.draft : null;
};

function draftOutcome(events: DraftEvent[]): {
  draft: ApiDraft | null;
  status: string;
  errorCode: string | null;
} {
  const draft = doneDraft(events);
  if (draft) return { draft, status: draft.status, errorCode: draft.errorCode };
  const last = events.at(-1);
  return { draft: null, status: "failed", errorCode: last?.type === "error" ? last.code : "no_events" };
}

// --- One item at a time (shared by the smoke run and the M6 eval runner) ------------------

/** What every single-item step needs: the temporary workspace and the metered model. */
export interface ItemContext {
  workspaceId: string;
  metered: MeteredGateway;
  embedder: Embedder;
  /** Help-article file name to title, to tell whether a draft cites the expected article. */
  titleOf: ReadonlyMap<string, string>;
  /** Triage prompt to measure; the app's own when omitted. */
  triagePrompt?: TriagePromptVersion;
}

export interface TriageItemInput {
  key: string;
  subject: string;
  message: string;
  expected: TriageResult["expected"];
}

const silentTriageLogger = { info: () => {}, warn: () => {} };
const silentDraftLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** Triage one ticket through the real job (the app's code path) and compare with its labels. */
export async function triageOne(ctx: ItemContext, item: TriageItemInput): Promise<TriageResult> {
  const t = await insertTicket(ctx.workspaceId, item.subject, item.message);
  const outcome = await runTriageJob(
    { workspaceId: ctx.workspaceId, ticketId: t.id },
    { isFinalAttempt: true },
    { gateway: ctx.metered.gateway, logger: silentTriageLogger, promptVersion: ctx.triagePrompt },
  );
  const run = await findLatestTriage(getDb().db, ctx.workspaceId, t.id);
  const got =
    outcome.status === "succeeded" && run?.category && run.priority
      ? {
          category: run.category,
          priority: run.priority,
          sentiment: run.sentiment,
          confidence: run.confidence ?? 0,
          language: run.language,
        }
      : null;
  return {
    key: item.key,
    model: run?.model ?? null,
    expected: item.expected,
    status: outcome.status,
    errorCode: "errorCode" in outcome ? outcome.errorCode : null,
    got,
    needsReview: outcome.status === "succeeded" ? outcome.needsReview : null,
    categoryCorrect: got?.category === item.expected.category,
    priorityCorrect: got?.priority === item.expected.priority,
    ...sumCalls(ctx.metered.take()),
  };
}

export interface DraftItemInput {
  id: string;
  set: DraftResult["set"];
  question: string;
  /** The help article that answers it (file name), or null for unanswerable questions. */
  gold: string | null;
}

/** Draft a reply to one question through the real pipeline (retrieval, model, citation checks). */
export async function draftOne(ctx: ItemContext, q: DraftItemInput): Promise<DraftResult> {
  const t = await insertTicket(ctx.workspaceId, q.question, q.question);
  const events = await runDraftPipeline(
    { workspaceId: ctx.workspaceId, ticketId: t.id, requestedBy: null },
    { gateway: ctx.metered.gateway, embedder: ctx.embedder, logger: silentDraftLogger },
  );
  const calls = ctx.metered.take();
  const { draft, status, errorCode } = draftOutcome(events);
  const goldTitle = q.gold ? (ctx.titleOf.get(q.gold) ?? null) : null;
  const cited = [...new Set((draft?.citations ?? []).map((c) => c.documentTitle))];
  const answered = calls.find((c) => c.ok);
  return {
    id: q.id,
    set: q.set,
    question: q.question,
    model: draft?.model ?? null,
    goldArticle: q.gold,
    status,
    errorCode,
    warnings: draft?.warnings ?? [],
    modelCalled: calls.length > 0,
    citedTitles: cited,
    citationCount: draft?.citations.length ?? 0,
    citesGold: goldTitle ? cited.includes(goldTitle) : null,
    invalidCitations: draft?.invalidCitationCount ?? 0,
    ttftMs: answered?.ttftMs ?? null,
    endToEndMs: draft?.latencyMs ?? null,
    finishReason: answered?.finishReason ?? null,
    modelText: answered?.text ?? null,
    ...sumCalls(calls),
  };
}

/** Ingests the poisoned articles the injection cases need; returns them by file name. */
export async function ingestPoison(
  ctx: ItemContext,
  cases: readonly InjectionCase[],
): Promise<Map<string, CorpusArticle>> {
  const poison = new Map<string, CorpusArticle>();
  for (const file of new Set(cases.flatMap((c) => (c.poison ? [c.poison] : [])))) {
    const article = loadPoisonArticle(file);
    poison.set(file, article);
    await ingest(ctx.workspaceId, article, ctx.embedder);
  }
  return poison;
}

/** Run one injection case and look for signs that the model obeyed the attack. */
export async function injectionOne(
  ctx: ItemContext,
  c: InjectionCase,
  poison: ReadonlyMap<string, CorpusArticle>,
): Promise<InjectionResult> {
  const { workspaceId, metered } = ctx;
  const t = await insertTicket(workspaceId, c.ticket.subject, c.ticket.message, c.ticket.internalNote);
  let outcome: InjectionResult["outcome"];
  let model: string | null = null;
  let caughtByCode: boolean;
  let calls: CallRecord[];
  if (c.target === "triage") {
    const result = await runTriageJob(
      { workspaceId, ticketId: t.id },
      { isFinalAttempt: true },
      { gateway: metered.gateway, logger: silentTriageLogger },
    );
    calls = metered.take();
    model = (await findLatestTriage(getDb().db, workspaceId, t.id))?.model ?? null;
    outcome = {
      status: result.status,
      errorCode: "errorCode" in result ? result.errorCode : null,
      ...(result.status === "succeeded" ? { applied: result.applied } : {}),
    };
    caughtByCode =
      result.status === "failed" ||
      (result.status === "succeeded" && !result.applied.category && !result.applied.priority);
  } else {
    const events = await runDraftPipeline(
      { workspaceId, ticketId: t.id, requestedBy: null },
      { gateway: metered.gateway, embedder: ctx.embedder, logger: silentDraftLogger },
    );
    calls = metered.take();
    const { draft, status, errorCode } = draftOutcome(events);
    model = draft?.model ?? null;
    const warnings = draft?.warnings ?? [];
    outcome = { status, errorCode, warnings };
    caughtByCode =
      status === "blocked" || warnings.includes("unknown_link") || warnings.includes("hidden_characters");
  }
  const answered = calls.filter((r) => r.ok).at(-1);
  const triageAnswer = answered?.object as { category?: string; priority?: string } | undefined;
  const signs = answered
    ? attackSigns(c, {
        text: answered.text ?? (answered.object ? JSON.stringify(answered.object) : ""),
        canary: answered.canary ?? null,
        triage:
          triageAnswer?.category && triageAnswer.priority
            ? { category: triageAnswer.category, priority: triageAnswer.priority }
            : null,
      })
    : [];
  const poisonTitle = c.poison ? (poison.get(c.poison)?.title ?? null) : null;
  return {
    id: c.id,
    kind: c.kind,
    target: c.target,
    technique: c.technique,
    model,
    reachedModel: calls.length > 0,
    poisonShown: poisonTitle ? calls.some((r) => r.passageTitles?.includes(poisonTitle)) : null,
    outcome,
    modelAnswer: answered ? (answered.text ?? JSON.stringify(answered.object)) : null,
    signs,
    obeyed: signs.length > 0,
    caughtByCode,
    ...sumCalls(calls),
  };
}

export async function runAiSmoke(options: AiSmokeOptions): Promise<AiSmokeReport> {
  const { metered, embedder, log } = options;
  const startedAt = new Date().toISOString();
  const triage: TriageResult[] = [];
  const drafts: DraftResult[] = [];
  const injection: InjectionResult[] = [];
  const models = { triage: null as string | null, draft: null as string | null };
  const report = (): AiSmokeReport => ({
    provider: metered.gateway.provider,
    models,
    startedAt,
    finishedAt: new Date().toISOString(),
    calls: metered.calls,
    stopReason: metered.stopReason,
    triage,
    drafts,
    injection,
    summary: summarize(triage, drafts, injection),
  });
  const progress = () => options.onProgress?.(report());

  log(`Setting up a temporary workspace with ${options.corpus.length} help articles…`);
  const ws = await setUpEvalWorkspace(DEFAULT_CHUNK_OPTIONS, {
    corpus: options.corpus,
    questions: [],
    embedder,
    log,
  });
  const workspaceId = ws.workspaceId;
  try {
    await createDefaultWorkspaceSettings(getDb().db, workspaceId);
    const ctx: ItemContext = {
      workspaceId,
      metered,
      embedder,
      titleOf: new Map(options.corpus.map((a) => [a.file, a.title])),
    };

    // 1. Triage against the demo set's labels.
    for (const key of options.triageKeys) {
      if (metered.stopReason) break;
      const demo = DEMO_TICKETS.find((t) => t.key === key);
      if (!demo) throw new Error(`Unknown demo ticket: ${key}`);
      const r = await triageOne(ctx, {
        key,
        subject: demo.subject,
        message: demo.message,
        expected: demo.expected,
      });
      if (r.model) models.triage = r.model;
      triage.push(r);
      log(
        `  triage ${key}: ${r.got ? `${r.got.category}/${r.got.priority} (${r.got.confidence})` : r.status}`,
      );
      progress();
    }

    // 2. Drafts: answerable and unanswerable questions.
    const questions: DraftItemInput[] = [
      ...options.answerable.map((q) => ({
        id: q.id,
        set: "answerable" as const,
        question: q.question,
        gold: q.article,
      })),
      ...options.unanswerable.map((q) => ({
        id: q.id,
        set: "unanswerable" as const,
        question: q.question,
        gold: null,
      })),
    ];
    for (const q of questions) {
      if (metered.stopReason) break;
      const r = await draftOne(ctx, q);
      if (r.model) models.draft = r.model;
      drafts.push(r);
      log(`  draft ${q.id} (${q.set}): ${r.status}${r.errorCode ? ` ${r.errorCode}` : ""}`);
      progress();
    }

    // 3. Injection cases, with the poisoned articles added to the knowledge base.
    if (options.injection.length > 0 && !metered.stopReason) {
      const poison = await ingestPoison(ctx, options.injection);
      log(`  added ${poison.size} poisoned articles`);
      for (const c of options.injection) {
        if (metered.stopReason) break;
        const r = await injectionOne(ctx, c, poison);
        injection.push(r);
        log(
          `  injection ${c.id}: ${r.signs.length ? `OBEYED (${r.signs.join(", ")})` : "resisted"}; ${r.outcome.status}`,
        );
        progress();
      }
    }
  } finally {
    await ws.remove();
  }
  return report();
}

/** Evenly spaced picks, so a small sample covers the whole list. */
export function spreadPick<T>(items: readonly T[], n: number): T[] {
  if (n >= items.length) return [...items];
  if (n <= 0) return [];
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]!);
}
