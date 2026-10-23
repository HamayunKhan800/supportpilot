import { APICallError, generateText, registerTelemetry } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { MOCK_MODEL_ID } from "@/server/modules/ai/config";
import { createAiGateway, type AiGatewayOptions, type AiLedger } from "@/server/modules/ai/gateway";
import type { AiModels } from "@/server/modules/ai/models";
import { createGeminiEmbedder } from "@/server/modules/kb/embedder";
import { startTracing, type Tracing } from "@/server/platform/telemetry/setup";
import { SPAN_ATTRIBUTES } from "@/server/platform/telemetry/spans";

/**
 * Plan M6 D8: AI calls are traced with metadata only.
 *
 * 1. The AI SDK's own telemetry never fires for the app's calls. It is opt-out and, once any
 *    integration is registered, records prompts and outputs by default (AI SDK telemetry docs),
 *    so a capturing integration is registered here and must receive nothing.
 * 2. The gateway's own spans carry the feature, model, outcome and token counts, and none of
 *    the prompt or output text.
 */

const PROMPT = "Customer Zelda Quartermain: my invoice INV-77341 was charged twice";
const SYSTEM = "Secret system rules about tone and refunds";
const OUTPUT_TEXT = "Hello Zelda, I have refunded invoice INV-77341";
const TEXTS = ["Zelda", "Quartermain", "INV-77341", "Secret system rules", "charged twice", "refunded"];

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};
const STOP = { unified: "stop" as const, raw: "STOP" };
const schema = z.object({ category: z.enum(["billing", "bug"]), summary: z.string() });

type Chunk =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;

const objectModel = () =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify({ category: "billing", summary: OUTPUT_TEXT }) }],
      finishReason: STOP,
      usage,
      warnings: [],
    }),
  });

const streamModel = () =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream<Chunk>({
        chunks: [
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: OUTPUT_TEXT },
          { type: "text-end", id: "1" },
          { type: "finish", usage, finishReason: STOP },
        ],
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    }),
  });

const overloadedModel = () =>
  new MockLanguageModelV4({
    doStream: async () => {
      throw new APICallError({
        message: `overloaded while handling ${PROMPT}`,
        url: "https://example.test",
        requestBodyValues: { prompt: PROMPT },
        statusCode: 503,
        isRetryable: true,
      });
    },
  });

const ledger: AiLedger = {
  getPolicy: async () => ({ aiEnabled: true, monthlyTokenBudget: 1_000_000, tokensUsedThisMonth: 0 }),
  reserveDailyCall: async () => true,
  recordUsage: async () => {},
};
const quiet = { warn: () => {} } as unknown as AiGatewayOptions["logger"];

function gatewayWith(draft: MockLanguageModelV4, fallback?: MockLanguageModelV4) {
  const models: AiModels = {
    provider: "mock",
    models: {
      triage: { model: objectModel(), modelId: MOCK_MODEL_ID },
      draft: { model: draft, modelId: MOCK_MODEL_ID },
      grade: { model: objectModel(), modelId: MOCK_MODEL_ID },
    },
    ...(fallback ? { fallbacks: { draft: { model: fallback, modelId: "gemini-3.5-flash-lite" } } } : {}),
  };
  return createAiGateway({ models, ledger, dailyCallLimit: 100, logger: quiet });
}

const ctx = { workspaceId: "ws-telemetry", ticketId: "3f2b8c1e-9a4d-4c2b-8e1f-0a9b8c7d6e5f" };

const sdkEvents: string[] = [];
const exporter = new InMemorySpanExporter();
let tracing: Tracing;

beforeAll(() => {
  registerTelemetry({
    onStart: (event) => void sdkEvents.push(`start:${JSON.stringify(event).slice(0, 200)}`),
    onLanguageModelCallStart: () => void sdkEvents.push("model-call"),
    onEnd: () => void sdkEvents.push("end"),
  });
  tracing = startTracing({ serviceName: "supportpilot-test", exporter })!;
});
afterAll(async () => {
  registerTelemetry();
  await tracing.shutdown();
});
beforeEach(() => {
  sdkEvents.length = 0;
  exporter.reset();
});

describe("AI SDK telemetry is off for every app call (M6 D8)", () => {
  it("control: a call without the switch does reach the registered integration", async () => {
    await generateText({ model: objectModel(), prompt: PROMPT });
    expect(sdkEvents.length).toBeGreaterThan(0);
    expect(sdkEvents.join(" ")).toContain("Zelda"); // what the SDK would have recorded
  });

  it("gateway.generateObject sends it nothing", async () => {
    await gatewayWith(streamModel()).generateObject(ctx, {
      feature: "triage",
      system: SYSTEM,
      prompt: PROMPT,
      schema,
    });
    expect(sdkEvents).toEqual([]);
  });

  it("gateway.streamText sends it nothing, including the fallback attempt", async () => {
    await gatewayWith(streamModel()).streamText(ctx, {
      feature: "draft",
      system: SYSTEM,
      prompt: PROMPT,
      onDelta: () => {},
    });
    await gatewayWith(overloadedModel(), streamModel()).streamText(ctx, {
      feature: "draft",
      system: SYSTEM,
      prompt: PROMPT,
      onDelta: () => {},
    });
    expect(sdkEvents).toEqual([]);
  });

  it("the Gemini embedder sends it nothing", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ embedding: { values: Array.from({ length: 768 }, () => 0.1) } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    await createGeminiEmbedder({ apiKey: "test-key-not-real", fetch: fetchFn }).embedQuery(PROMPT);
    expect(sdkEvents).toEqual([]);
  });
});

describe("gateway spans carry metadata only (M6 D8)", () => {
  it("records feature, model, outcome and tokens for a structured call", async () => {
    await gatewayWith(streamModel()).generateObject(ctx, {
      feature: "triage",
      system: SYSTEM,
      prompt: PROMPT,
      schema,
    });
    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe("ai triage");
    expect(span?.attributes).toMatchObject({
      [SPAN_ATTRIBUTES.aiFeature]: "triage",
      [SPAN_ATTRIBUTES.genAiModel]: MOCK_MODEL_ID,
      [SPAN_ATTRIBUTES.genAiProvider]: "mock",
      [SPAN_ATTRIBUTES.aiOutcome]: "ok",
      [SPAN_ATTRIBUTES.genAiInputTokens]: 100,
      [SPAN_ATTRIBUTES.genAiOutputTokens]: 20,
      [SPAN_ATTRIBUTES.aiFallback]: false,
      [SPAN_ATTRIBUTES.workspaceId]: ctx.workspaceId,
      [SPAN_ATTRIBUTES.ticketId]: ctx.ticketId,
    });
  });

  it("records one span per attempt when a draft falls back, with the failure as a code", async () => {
    await gatewayWith(overloadedModel(), streamModel()).streamText(ctx, {
      feature: "draft",
      system: SYSTEM,
      prompt: PROMPT,
      onDelta: () => {},
    });
    const spans = exporter.getFinishedSpans();
    expect(
      spans.map((s) => [s.name, s.attributes[SPAN_ATTRIBUTES.aiFallback], s.attributes["error.type"]]),
    ).toEqual([
      ["ai draft", false, "ai_unavailable"],
      ["ai draft", true, undefined],
    ]);
    expect(spans[1]?.attributes[SPAN_ATTRIBUTES.genAiFinishReasons]).toEqual(["stop"]);
    expect(spans[1]?.attributes[SPAN_ATTRIBUTES.genAiModel]).toBe("gemini-3.5-flash-lite");
  });

  it("records a refused call (AI turned off) without calling the model", async () => {
    const off = createAiGateway({
      models: {
        provider: "mock",
        models: {
          triage: { model: objectModel(), modelId: MOCK_MODEL_ID },
          draft: { model: streamModel(), modelId: MOCK_MODEL_ID },
          grade: { model: objectModel(), modelId: MOCK_MODEL_ID },
        },
      },
      ledger: {
        ...ledger,
        getPolicy: async () => ({ aiEnabled: false, monthlyTokenBudget: 1, tokensUsedThisMonth: 0 }),
      },
      dailyCallLimit: 100,
      logger: quiet,
    });
    await expect(
      off.generateObject(ctx, { feature: "triage", system: SYSTEM, prompt: PROMPT, schema }),
    ).rejects.toMatchObject({
      code: "ai_disabled",
    });
    expect(exporter.getFinishedSpans()[0]?.attributes["error.type"]).toBe("ai_disabled");
  });

  it("never contains the prompt, the system prompt or the output", async () => {
    const gw = gatewayWith(overloadedModel(), streamModel());
    await gw.generateObject(ctx, { feature: "triage", system: SYSTEM, prompt: PROMPT, schema });
    await gw.streamText(ctx, { feature: "draft", system: SYSTEM, prompt: PROMPT, onDelta: () => {} });
    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBe(3);
    const json = JSON.stringify(
      spans.map((s) => ({ name: s.name, attributes: s.attributes, events: s.events, status: s.status })),
    );
    for (const text of TEXTS) expect(json).not.toContain(text);
  });
});
