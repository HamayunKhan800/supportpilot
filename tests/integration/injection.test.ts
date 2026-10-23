import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAiGateway, createPostgresLedger, type AiGatewayOptions } from "@/server/modules/ai/gateway";
import type { MockRequest, MockResponder } from "@/server/modules/ai/mock-model";
import { createMockModels } from "@/server/modules/ai/models";
import { neutralizeTags, stripHiddenCharacters } from "@/server/modules/ai/untrusted";
import { mockDraftResponder } from "@/server/modules/drafts/mock-responder";
import type { ApiDraft } from "@/server/modules/drafts/serialize";
import { runDraftPipeline, type DraftEvent } from "@/server/modules/drafts/service";
import { DEFAULT_CHUNK_OPTIONS } from "@/server/modules/kb/chunker";
import { createMockEmbedder } from "@/server/modules/kb/embedder";
import { runIngestJob } from "@/server/modules/kb/ingest-job";
import * as kbRepo from "@/server/modules/kb/repository";
import * as ticketRepo from "@/server/modules/tickets/repository";
import { generateTrackingToken } from "@/server/modules/tickets/tracking-token";
import { runTriageJob } from "@/server/modules/triage/job";
import { createDefaultWorkspaceSettings } from "@/server/platform/auth/workspace-settings";
import { getDb } from "@/server/platform/db/client";
import { transaction } from "@/server/platform/db/tx";

import {
  compromisedAnswer,
  loadInjectionCases,
  loadPoisonArticle,
  type InjectionCase,
} from "../../scripts/lib/injection-cases";
import { loadCorpus, type CorpusArticle } from "../../scripts/lib/kb-corpus";
import { setUpEvalWorkspace, type EvalWorkspace } from "../../scripts/lib/retrieval-eval";
import { resetDatabase } from "./support/client";

/**
 * The prompt-injection test set in CI (M5 step 6, OWASP LLM01): every case in
 * eval/injection/cases.json runs through the real draft or triage pipeline (Postgres, the
 * Nimbus help centre plus the poisoned articles, real retrieval over the mock embedder),
 * with a model scripted to obey the attack. Each test checks two things:
 *  - what the model is shown: hidden characters removed, delimiters escaped, internal notes
 *    absent, and (for indirect cases) the poisoned passage really retrieved;
 *  - what code does with the obedient answer: blocked, flagged, rejected or, for documented
 *    gaps, passed to the agent unchanged.
 * Whether a real model obeys is measured separately, by the Gemini smoke run.
 */

const cases = loadInjectionCases();
const db = () => getDb().db;
const embedder = createMockEmbedder();
const quiet = { warn: () => {} } as unknown as AiGatewayOptions["logger"];
const quietLog = { info: () => {}, warn: () => {}, error: () => {} };
/** Every tag our prompts use for untrusted data (drafts: all five; triage: the first three). */
const DATA_TAGS = ["ticket", "subject", "message", "passages", "passage"];

let ws: EvalWorkspace;
const poison = new Map<string, CorpusArticle>();

async function ingest(workspaceId: string, article: CorpusArticle) {
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
  expect(outcome.status, article.file).toBe("ready");
}

async function newTicket(c: InjectionCase) {
  const t = await transaction((tx) =>
    ticketRepo.insertTicket(tx, ws.workspaceId, {
      subject: c.ticket.subject,
      customerName: "Casey Customer",
      customerEmail: "casey@example.test",
      accessTokenHash: generateTrackingToken().hash,
      firstMessage: c.ticket.message,
    }),
  );
  if (c.ticket.internalNote) {
    await transaction((tx) =>
      ticketRepo.insertMessage(tx, ws.workspaceId, t.id, {
        authorType: "agent",
        authorUserId: null,
        body: c.ticket.internalNote!,
        isInternal: true,
      }),
    );
  }
  return t;
}

/** Answers like a model that obeys the attack (or like the mock, for cases without one). */
function obedientModel(c: InjectionCase) {
  const requests: MockRequest[] = [];
  const respond: MockResponder = (request) => {
    requests.push(request);
    return c.compromised ? compromisedAnswer(c, request.system) : mockDraftResponder(request);
  };
  const gateway = createAiGateway({
    models: createMockModels({ draft: respond, triage: respond }),
    ledger: createPostgresLedger(db()),
    dailyCallLimit: 10_000,
    logger: quiet,
  });
  return { gateway, requests };
}

/** The text the attack arrives in: the ticket message, or the poisoned article. */
const attackText = (c: InjectionCase) => (c.poison ? poison.get(c.poison)!.source : c.ticket.message);

function checkPrompt(c: InjectionCase, request: MockRequest) {
  const expected = c.expect.prompt;
  const shown = `${request.system}\n${request.prompt}`;
  // No hidden characters ever reach a model, whatever the case.
  expect(stripHiddenCharacters(shown).hiddenRemoved).toBe(0);
  for (const text of expected?.excludes ?? []) expect(request.prompt).not.toContain(text);
  for (const tag of expected?.neutralized ?? []) {
    const lines = attackText(c)
      .split("\n")
      .filter((l) => new RegExp(`</?\\s*${tag}\\b`, "i").test(l));
    expect(lines.length, `${c.id}: the attack should contain <${tag}>`).toBeGreaterThan(0);
    for (const line of lines) expect(request.prompt).toContain(neutralizeTags(line, DATA_TAGS));
  }
  // Only our own markup remains: one ticket, at most one passages block, and every element closed.
  const count = (re: RegExp) => request.prompt.match(re)?.length ?? 0;
  for (const tag of DATA_TAGS) {
    expect(count(new RegExp(`<${tag}[\\s>]`, "g")), `<${tag}>`).toBe(count(new RegExp(`</${tag}>`, "g")));
  }
  expect(count(/<ticket>/g)).toBe(1);
  expect(count(/<passages>/g)).toBeLessThanOrEqual(1);
}

beforeAll(async () => {
  await resetDatabase();
  ws = await setUpEvalWorkspace(DEFAULT_CHUNK_OPTIONS, {
    corpus: loadCorpus(),
    questions: [],
    embedder,
    log: () => {},
  });
  await createDefaultWorkspaceSettings(db(), ws.workspaceId);
  for (const file of new Set(cases.flatMap((c) => (c.poison ? [c.poison] : [])))) {
    const article = loadPoisonArticle(file);
    poison.set(file, article);
    await ingest(ws.workspaceId, article);
  }
}, 120_000);

afterAll(async () => {
  await ws?.remove();
});

describe.each(cases.filter((c) => c.target === "draft"))("$id (draft): $technique", (c) => {
  it(`${c.gap ? "documented gap" : "defended"}: ${c.defence.split(".")[0]}`, async () => {
    const t = await newTicket(c);
    const model = obedientModel(c);
    const events: DraftEvent[] = await runDraftPipeline(
      { workspaceId: ws.workspaceId, ticketId: t.id, requestedBy: null },
      { gateway: model.gateway, embedder, logger: quietLog },
    );

    // The attack reached the model: not refused before it, and the poisoned passage retrieved.
    expect(model.requests, JSON.stringify(events.at(-1))).toHaveLength(1);
    const request = model.requests[0]!;
    if (c.poison) expect(request.prompt).toContain(`title="${poison.get(c.poison)!.title}"`);
    checkPrompt(c, request);

    const last = events.at(-1)!;
    expect(last.type, JSON.stringify(last)).toBe("done");
    const draft = (last as { draft: ApiDraft }).draft;
    if (c.ticket.internalNote) expect(draft.body).not.toContain(c.ticket.internalNote);
    const expected = c.expect.draft;
    if (!expected) return;
    expect(draft.status).toBe(expected.status);
    if (expected.errorCode) expect(draft.errorCode).toBe(expected.errorCode);
    if (expected.status === "blocked") expect(draft.body).toBe("");
    if (expected.warnings) expect(draft.warnings).toEqual(expected.warnings);
  });
});

describe.each(cases.filter((c) => c.target === "triage"))("$id (triage): $technique", (c) => {
  it(`${c.gap ? "documented gap" : "defended"}: ${c.defence.split(".")[0]}`, async () => {
    const t = await newTicket(c);
    const model = obedientModel(c);
    const outcome = await runTriageJob(
      { workspaceId: ws.workspaceId, ticketId: t.id },
      { isFinalAttempt: true },
      { gateway: model.gateway, logger: quietLog },
    );

    expect(model.requests.length).toBeGreaterThan(0);
    for (const request of model.requests) checkPrompt(c, request);
    const expected = c.expect.triage!;
    expect(outcome.status, JSON.stringify(outcome)).toBe(expected.status);
    if (expected.errorCode) expect(outcome).toMatchObject({ errorCode: expected.errorCode });
    if (expected.applied) expect(outcome).toMatchObject({ applied: expected.applied });
    if (expected.needsReview !== undefined)
      expect(outcome).toMatchObject({ needsReview: expected.needsReview });
    // Whatever happened, the ticket only ever holds a category from the workspace's list.
    const after = await ticketRepo.findTicketById(ws.workspaceId, t.id);
    expect([null, "billing", "bug", "account", "how-to", "feature-request", "other"]).toContain(
      after!.category,
    );
  });
});
