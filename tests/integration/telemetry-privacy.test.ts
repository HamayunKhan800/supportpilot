import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAiGateway, createPostgresLedger, type AiGatewayOptions } from "@/server/modules/ai/gateway";
import { createMockModels } from "@/server/modules/ai/models";
import { mockDraftResponder } from "@/server/modules/drafts/mock-responder";
import { startDraft } from "@/server/modules/drafts/service";
import { createMockEmbedder } from "@/server/modules/kb/embedder";
import { runIngestJob } from "@/server/modules/kb/ingest-job";
import { searchKnowledgeBase } from "@/server/modules/kb/service";
import { runTriageJob } from "@/server/modules/triage/job";
import { mockTriageResponder } from "@/server/modules/triage/mock-responder";
import { getAuth } from "@/server/platform/auth";
import { getDb } from "@/server/platform/db/client";
import { resetEnvCache } from "@/server/platform/env";
import { stopWebBoss } from "@/server/platform/jobs/boss";
import { AI_TRIAGE_QUEUE, KB_INGEST_QUEUE } from "@/server/platform/jobs/queues";
import { startTracing, type Tracing } from "@/server/platform/telemetry/setup";
import { SPAN_ATTRIBUTES } from "@/server/platform/telemetry/spans";
import { traced } from "@/worker/traced-job";

import { call, parseNdjson } from "./support/api";
import { resetDatabase, signUpAndIn, type TestClient } from "./support/client";

/**
 * Plan M6 D8: traces must never contain customer or article text. Runs the real flows (a
 * customer request through the portal API, triage through the worker's job wrapper, an
 * article upload and ingestion, a search, a draft) with tracing on, exporting through the same
 * redacting exporter production uses, then searches every exported span (names, attributes,
 * events, status, resource) for the text that went in.
 *
 * Next.js's own request spans only exist inside a running Next.js server; they are checked
 * against a real build in docs/observability.md ("Checking for leaks").
 */

const CUSTOMER = { name: "Ottoline Vandersnoot", email: "ottoline.vandersnoot@example.test" };
const SUBJECT = "Kestrel invoice duplicated";
const MESSAGE = "My Kestrel subscription invoice KX-55102 was charged twice on my Visa ending 4417.";
const ARTICLE = `# Kestrel billing

Duplicate Kestrel charges are reversed within 7 business days. Ask for invoice KX references.
The quokka team approves refunds for Kestrel annual plans within 30 days.`;
const SEARCH = "How fast are duplicate Kestrel charges reversed?";

/** Every piece of text a customer, an admin or the model wrote. None may reach a span. */
const PRIVATE_TEXT = [
  "Ottoline",
  "Vandersnoot",
  "ottoline.vandersnoot",
  "Kestrel",
  "KX-55102",
  "4417",
  "charged twice",
  "quokka",
  "business days",
  "duplicate",
];

const handler = (req: Request) => getAuth().handler(req);
const quiet = { warn: () => {} } as unknown as AiGatewayOptions["logger"];
const quietLog = { info: () => {}, warn: () => {}, error: () => {}, child: () => quietLog } as never;
const embedder = createMockEmbedder();
const exporter = new InMemorySpanExporter();

let tracing: Tracing;
let owner: TestClient;
let acmeId: string;
let spans: ReadableSpan[] = [];
let trackingToken = "";

const gateway = () =>
  createAiGateway({
    models: createMockModels({ triage: mockTriageResponder, draft: mockDraftResponder }),
    ledger: createPostgresLedger(getDb().db),
    dailyCallLimit: 10_000,
    logger: quiet,
  });

/** Everything a span would send, as one string. */
function exported(span: ReadableSpan): string {
  return JSON.stringify({
    name: span.name,
    attributes: span.attributes,
    events: span.events,
    status: span.status,
    links: span.links.map((l) => l.attributes ?? {}),
    resource: span.resource.attributes,
  });
}

beforeAll(async () => {
  process.env.TRUST_PROXY_HEADERS = "true";
  resetEnvCache();
  await resetDatabase();
  owner = await signUpAndIn(handler, "owner@acme.test");
  acmeId = (await owner.post("/organization/create", { name: "Acme Support", slug: "acme" })).json.id;

  tracing = startTracing({ serviceName: "supportpilot-test", exporter })!;

  // 1. A customer request through the public portal API.
  const created = await call("createPortalTicket", {
    params: { slug: "acme" },
    body: { name: CUSTOMER.name, email: CUSTOMER.email, subject: SUBJECT, message: MESSAGE },
    headers: { "x-forwarded-for": "203.0.113.77" },
  });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  trackingToken = new URL(created.json.trackingUrl).pathname.split("/").pop()!;
  const list = await call("listTickets", { as: owner, query: { sort: "newest", limit: "1" } });
  const ticketId: string = list.json.items[0].id;

  // 2. Triage, through the worker's job wrapper (span "job ai.triage").
  const job = { id: "job-triage-1", name: AI_TRIAGE_QUEUE, data: {}, retryCount: 0, retryLimit: 2 } as never;
  const triage = await traced(AI_TRIAGE_QUEUE, job, { workspaceId: acmeId, ticketId }, () =>
    runTriageJob(
      { workspaceId: acmeId, ticketId },
      { isFinalAttempt: true },
      { gateway: gateway(), logger: quietLog },
    ),
  );
  expect(triage.status).toBe("succeeded");

  // 3. An article: upload through the API, ingestion through the job wrapper.
  const fd = new FormData();
  fd.set("file", new File([ARTICLE], "kestrel-billing.md", { type: "text/markdown" }));
  const upload = await call("uploadKbDocument", { as: owner, body: fd });
  expect(upload.status, JSON.stringify(upload.json)).toBe(201);
  const ingestJob = {
    id: "job-ingest-1",
    name: KB_INGEST_QUEUE,
    data: {},
    retryCount: 0,
    retryLimit: 2,
  } as never;
  const ingest = await traced(
    KB_INGEST_QUEUE,
    ingestJob,
    { workspaceId: acmeId, documentId: upload.json.id },
    () =>
      runIngestJob(
        { workspaceId: acmeId, documentId: upload.json.id },
        { isFinalAttempt: true },
        { embedder },
      ),
  );
  expect(ingest.status).toBe("ready");

  // 4. The admin's test search.
  const search = await searchKnowledgeBase(owner.headers, { query: SEARCH }, { embedder });
  expect(search.results.length).toBeGreaterThan(0);

  // 5. A reply draft (retrieval, then the streamed model call).
  const stream = await startDraft(owner.headers, ticketId, {
    deps: { gateway: gateway(), embedder, logger: quietLog },
  });
  const events = parseNdjson(await new Response(stream).text()) as Array<{ type: string }>;
  expect(events.at(-1)?.type).toBe("done");

  // 6. The customer opens their private link and replies.
  const reply = await call("addCustomerReply", {
    params: { token: trackingToken },
    body: { message: "Still charged twice, please hurry. Kestrel KX-55102." },
    headers: { "x-forwarded-for": "203.0.113.78" },
  });
  expect(reply.status, JSON.stringify(reply.json)).toBeLessThan(300);

  await tracing.forceFlush();
  spans = exporter.getFinishedSpans();
});

afterAll(async () => {
  await tracing?.shutdown();
  await stopWebBoss();
});

describe("exported spans contain no customer or article text (M6 D8)", () => {
  it("recorded the flows: jobs, AI calls, searches and the draft", () => {
    const names = spans.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "job ai.triage",
        "ai triage",
        "job kb.ingest",
        "kb.search",
        "draft.generate",
        "ai draft",
      ]),
    );
    const draft = spans.find((s) => s.name === "draft.generate")!;
    expect(draft.attributes[SPAN_ATTRIBUTES.draftOutcome]).toBe("ready");
    expect(draft.attributes[SPAN_ATTRIBUTES.kbTopScore]).toEqual(expect.any(Number));
    const aiTriage = spans.find((s) => s.name === "ai triage")!;
    expect(aiTriage.attributes[SPAN_ATTRIBUTES.genAiInputTokens]).toEqual(expect.any(Number));
    // The AI span is a child of the job span: one trace per job.
    const job = spans.find((s) => s.name === "job ai.triage")!;
    expect(aiTriage.spanContext().traceId).toBe(job.spanContext().traceId);
    expect(job.attributes[SPAN_ATTRIBUTES.jobOutcome]).toBe("succeeded");
  });

  it.each(PRIVATE_TEXT)("no span contains %j", (text) => {
    const leaks = spans
      .filter((s) => exported(s).toLowerCase().includes(text.toLowerCase()))
      .map((s) => s.name);
    expect(leaks).toEqual([]);
  });

  it("no span contains the customer's private link token", () => {
    expect(trackingToken).toHaveLength(43);
    expect(spans.filter((s) => exported(s).includes(trackingToken)).map((s) => s.name)).toEqual([]);
  });
});
