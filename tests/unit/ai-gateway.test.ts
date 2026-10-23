import { APICallError } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MOCK_MODEL_ID, type FeatureSettings } from "@/server/modules/ai/config";
import { AiError } from "@/server/modules/ai/errors";
import {
  createAiGateway,
  shouldFallBack,
  type AiGatewayOptions,
  type AiLedger,
} from "@/server/modules/ai/gateway";
import type { AiModels } from "@/server/modules/ai/models";
import type { AiPolicy, AiUsageRecord } from "@/server/modules/ai/repository";

/**
 * Fault injection for the AI gateway (M5 D12, D13; plan step 1): every failure the provider can
 * produce, simulated with the AI SDK's MockLanguageModelV4, plus the pre-call guards.
 */

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};
const STOP = { unified: "stop" as const, raw: "STOP" };
const schema = z.object({ category: z.enum(["billing", "bug"]), confidence: z.number().min(0).max(1) });
const apiError = (statusCode: number, headers?: Record<string, string>) =>
  new APICallError({
    message: "provider error",
    url: "https://example.test",
    requestBodyValues: {},
    statusCode,
    responseHeaders: headers,
    isRetryable: statusCode === 429 || statusCode >= 500,
  });

function fakeLedger(policy: Partial<AiPolicy> | null = {}) {
  const records: Array<{ workspaceId: string; row: AiUsageRecord }> = [];
  const state = { reserved: 0, failRecord: false };
  const ledger: AiLedger = {
    getPolicy: async () =>
      policy === null
        ? null
        : { aiEnabled: true, monthlyTokenBudget: 1_000_000, tokensUsedThisMonth: 0, ...policy },
    reserveDailyCall: async (limit) => {
      if (state.reserved >= limit) return false;
      state.reserved += 1;
      return true;
    },
    recordUsage: async (workspaceId, row) => {
      if (state.failRecord) throw new Error("db down");
      records.push({ workspaceId, row });
    },
  };
  return { ledger, records, state };
}

const FALLBACK_ID = "gemini-3.5-flash-lite";

function modelsWith(model: MockLanguageModelV4, fallback?: MockLanguageModelV4): AiModels {
  return {
    provider: "mock",
    models: {
      triage: { model, modelId: MOCK_MODEL_ID },
      draft: { model, modelId: MOCK_MODEL_ID },
      grade: { model, modelId: MOCK_MODEL_ID },
    },
    ...(fallback ? { fallbacks: { draft: { model: fallback, modelId: FALLBACK_ID } } } : {}),
  };
}

function setup(
  model: MockLanguageModelV4,
  options: {
    policy?: Partial<AiPolicy> | null;
    dailyCallLimit?: number;
    settings?: Partial<Record<"triage" | "draft", Partial<FeatureSettings>>>;
    breakerClock?: () => number;
    fallback?: MockLanguageModelV4;
  } = {},
) {
  const { ledger, records, state } = fakeLedger(options.policy === undefined ? {} : options.policy);
  const warnings: unknown[] = [];
  const gateway = createAiGateway({
    models: modelsWith(model, options.fallback),
    ledger,
    dailyCallLimit: options.dailyCallLimit ?? 100,
    settings: options.settings,
    breakerClock: options.breakerClock,
    // pino's warn() is overloaded; the gateway only ever passes (object, message).
    logger: { warn: (obj: unknown) => void warnings.push(obj) } as unknown as AiGatewayOptions["logger"],
  });
  return { gateway, records, state, warnings };
}

const generating = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({ content: [{ type: "text", text }], finishReason: STOP, usage, warnings: [] }),
  });
const failingGenerate = (error: unknown) =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });
/** Never answers; rejects when the SDK aborts it (timeout or caller). */
const hangingGenerate = () =>
  new MockLanguageModelV4({
    doGenerate: (options) =>
      new Promise((_, reject) => {
        const signal = options.abortSignal;
        if (signal?.aborted) return reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason));
      }),
  });

const ctx = { workspaceId: "ws-1", ticketId: "t-1" };
const triage = {
  feature: "triage" as const,
  system: "Classify the ticket.",
  prompt: "I was charged twice",
  schema,
};

describe("generateObject: success", () => {
  it("returns the validated object and records usage with outcome, tokens, cost, latency and ticket", async () => {
    const model = generating('{"category":"billing","confidence":0.9}');
    const { gateway, records } = setup(model);
    const result = await gateway.generateObject(ctx, triage);
    expect(result.object).toEqual({ category: "billing", confidence: 0.9 });
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20, estCostMicros: 0 });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      workspaceId: "ws-1",
      row: {
        feature: "triage",
        model: MOCK_MODEL_ID,
        inputTokens: 100,
        outputTokens: 20,
        outcome: "ok",
        ticketId: "t-1",
        ttftMs: null,
      },
    });
    expect(records[0]!.row.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("sends the feature's output cap, thinking level and JSON mode, with no SDK retries", async () => {
    const model = generating('{"category":"bug","confidence":0.5}');
    const { gateway } = setup(model);
    await gateway.generateObject(ctx, triage);
    expect(model.doGenerateCalls).toHaveLength(1);
    const call = model.doGenerateCalls[0]!;
    expect(call.maxOutputTokens).toBe(200);
    expect(call.reasoning).toBe("minimal");
    expect(call.responseFormat?.type).toBe("json");
  });
});

describe("generateObject: fault injection", () => {
  it("malformed JSON → ai_invalid_output; tokens still recorded; the breaker does not count it", async () => {
    const model = generating("Sure! The category is billing.");
    const { gateway, records } = setup(model);
    for (let i = 0; i < 6; i++) {
      await expect(gateway.generateObject(ctx, triage)).rejects.toMatchObject({ code: "ai_invalid_output" });
    }
    expect(records[0]!.row).toMatchObject({ outcome: "invalid", inputTokens: 100, outputTokens: 20 });
    expect(gateway.circuitState("triage")).toBe("closed");
  });

  it("schema-invalid output (category not in the list, confidence > 1) → ai_invalid_output", async () => {
    for (const text of [
      '{"category":"refunds","confidence":0.9}',
      '{"category":"bug","confidence":7}',
      "{}",
    ]) {
      const { gateway, records } = setup(generating(text));
      await expect(gateway.generateObject(ctx, triage)).rejects.toMatchObject({ code: "ai_invalid_output" });
      expect(records[0]!.row.outcome).toBe("invalid");
    }
  });

  it("429 → ai_unavailable with Retry-After, after exactly one provider request", async () => {
    const model = failingGenerate(apiError(429, { "retry-after": "12" }));
    const { gateway, records, warnings } = setup(model);
    const error = await gateway.generateObject(ctx, triage).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code: "ai_unavailable", retryAfterMs: 12_000, temporary: true });
    expect(model.doGenerateCalls).toHaveLength(1); // maxRetries: 0, the cap counts every request
    expect(records[0]!.row).toMatchObject({ outcome: "error", inputTokens: 0, outputTokens: 0 });
    expect(warnings[0]).toMatchObject({ code: "ai_unavailable", status: 429, feature: "triage" });
  });

  it("500 → ai_unavailable; 401 → ai_rejected (not temporary)", async () => {
    const a = setup(failingGenerate(apiError(500)));
    await expect(a.gateway.generateObject(ctx, triage)).rejects.toMatchObject({ code: "ai_unavailable" });
    const b = setup(failingGenerate(apiError(401)));
    await expect(b.gateway.generateObject(ctx, triage)).rejects.toMatchObject({
      code: "ai_rejected",
      temporary: false,
    });
  });

  it("no answer within the total timeout → ai_timeout", async () => {
    const { gateway, records } = setup(hangingGenerate(), {
      settings: { triage: { timeout: { totalMs: 50 } } },
    });
    const started = Date.now();
    await expect(gateway.generateObject(ctx, triage)).rejects.toMatchObject({ code: "ai_timeout" });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(records[0]!.row.outcome).toBe("timeout");
  });

  it("caller aborts mid-call → ai_aborted; recorded, but the breaker is not charged", async () => {
    const controller = new AbortController();
    const { gateway, records } = setup(hangingGenerate());
    setTimeout(() => controller.abort(), 20);
    await expect(gateway.generateObject({ ...ctx, signal: controller.signal }, triage)).rejects.toMatchObject(
      {
        code: "ai_aborted",
      },
    );
    expect(records[0]!.row.outcome).toBe("aborted");
    expect(gateway.circuitState("triage")).toBe("closed");
  });

  it("a usage-recording failure is logged and does not hide the result", async () => {
    const { gateway, state, warnings } = setup(generating('{"category":"bug","confidence":1}'));
    state.failRecord = true;
    await expect(gateway.generateObject(ctx, triage)).resolves.toMatchObject({ object: { category: "bug" } });
    expect(warnings).toHaveLength(1);
  });
});

describe("guards before any provider call", () => {
  it("an already-aborted caller makes no call and reserves nothing", async () => {
    const model = generating("{}");
    const { gateway, state } = setup(model);
    const controller = new AbortController();
    controller.abort();
    await expect(gateway.generateObject({ ...ctx, signal: controller.signal }, triage)).rejects.toMatchObject(
      {
        code: "ai_aborted",
      },
    );
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(state.reserved).toBe(0);
  });

  it.each([
    ["AI switched off", { aiEnabled: false }, "ai_disabled"],
    ["no settings row (fail closed)", null, "ai_disabled"],
    [
      "budget used up exactly",
      { monthlyTokenBudget: 1000, tokensUsedThisMonth: 1000 },
      "ai_budget_exhausted",
    ],
    ["budget overshot", { monthlyTokenBudget: 1000, tokensUsedThisMonth: 5000 }, "ai_budget_exhausted"],
  ] as const)("%s → %s, no call, nothing reserved or recorded", async (_label, policy, code) => {
    const model = generating("{}");
    const { gateway, state, records } = setup(model, { policy });
    await expect(gateway.generateObject(ctx, triage)).rejects.toMatchObject({ code });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(state.reserved).toBe(0);
    expect(records).toHaveLength(0);
  });

  it("a budget with tokens left still allows the call", async () => {
    const { gateway } = setup(generating('{"category":"bug","confidence":1}'), {
      policy: { monthlyTokenBudget: 1000, tokensUsedThisMonth: 999 },
    });
    await expect(gateway.generateObject(ctx, triage)).resolves.toBeDefined();
  });

  it("the daily cap stops calls once reached, counting failed calls too", async () => {
    let n = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        n += 1;
        if (n === 1) throw apiError(500);
        return {
          content: [{ type: "text", text: '{"category":"bug","confidence":1}' }],
          finishReason: STOP,
          usage,
          warnings: [],
        };
      },
    });
    const { gateway } = setup(model, { dailyCallLimit: 2 });
    await expect(gateway.generateObject(ctx, triage)).rejects.toMatchObject({ code: "ai_unavailable" });
    await expect(gateway.generateObject(ctx, triage)).resolves.toBeDefined();
    await expect(gateway.generateObject(ctx, triage)).rejects.toMatchObject({ code: "ai_daily_limit" });
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("a cap of 0 turns generation off", async () => {
    const model = generating("{}");
    const { gateway } = setup(model, { dailyCallLimit: 0 });
    await expect(gateway.generateObject(ctx, triage)).rejects.toMatchObject({ code: "ai_daily_limit" });
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe("circuit breaker in the gateway (D13)", () => {
  it("5 consecutive failures open it for 60 s; calls then fail at once without reaching the provider", async () => {
    let now = 0;
    let healthy = false;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        if (!healthy) throw apiError(503);
        return {
          content: [{ type: "text", text: '{"category":"bug","confidence":1}' }],
          finishReason: STOP,
          usage,
          warnings: [],
        };
      },
    });
    const { gateway, state } = setup(model, { breakerClock: () => now });
    for (let i = 0; i < 5; i++) {
      await expect(gateway.generateObject(ctx, triage)).rejects.toMatchObject({ code: "ai_unavailable" });
    }
    expect(gateway.circuitState("triage")).toBe("open");
    now = 10_000;
    const fast = await gateway.generateObject(ctx, triage).catch((e: unknown) => e);
    expect(fast).toMatchObject({ code: "ai_unavailable", retryAfterMs: 50_000 });
    expect(model.doGenerateCalls).toHaveLength(5);
    expect(state.reserved).toBe(5); // an open circuit doesn't use up the daily cap
    // Drafts use another model and have their own breaker.
    expect(gateway.circuitState("draft")).toBe("closed");

    now = 60_000;
    healthy = true;
    await expect(gateway.generateObject(ctx, triage)).resolves.toBeDefined(); // half-open trial
    expect(gateway.circuitState("triage")).toBe("closed");
  });

  it("timeouts and rejections count as failures; a half-open trial that fails re-opens it", async () => {
    let now = 0;
    const { gateway } = setup(failingGenerate(apiError(403)), { breakerClock: () => now });
    for (let i = 0; i < 5; i++) await gateway.generateObject(ctx, triage).catch(() => {});
    expect(gateway.circuitState("triage")).toBe("open");
    now = 60_000;
    await expect(gateway.generateObject(ctx, triage)).rejects.toMatchObject({ code: "ai_rejected" });
    expect(gateway.circuitState("triage")).toBe("open");
  });

  it("frees the half-open trial when the daily cap refuses the call", async () => {
    let now = 0;
    const { gateway, state } = setup(failingGenerate(apiError(500)), {
      breakerClock: () => now,
      dailyCallLimit: 5,
    });
    for (let i = 0; i < 5; i++) await gateway.generateObject(ctx, triage).catch(() => {});
    now = 60_000;
    await expect(gateway.generateObject(ctx, triage)).rejects.toMatchObject({ code: "ai_daily_limit" });
    expect(state.reserved).toBe(5);
    expect(gateway.circuitState("triage")).toBe("half-open");
    // Not stuck waiting for a trial that never ran: the next call reaches the cap check again
    // instead of being refused by the breaker.
    await expect(gateway.generateObject(ctx, triage)).rejects.toMatchObject({ code: "ai_daily_limit" });
  });
});

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/** A provider stream part (LanguageModelV4StreamPart), taken from the mock's own signature. */
type Chunk =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;
const textChunks = (...deltas: string[]): Chunk[] => [
  { type: "text-start", id: "1" },
  ...deltas.map((delta): Chunk => ({ type: "text-delta", id: "1", delta })),
  { type: "text-end", id: "1" },
];
const finish = (unified: "stop" | "length" = "stop"): Chunk => ({
  type: "finish",
  usage,
  finishReason: { unified, raw: unified.toUpperCase() },
});

function streaming(
  chunks: Chunk[],
  delays: { initialDelayInMs?: number | null; chunkDelayInMs?: number | null } = {},
) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream<Chunk>({
        chunks,
        initialDelayInMs: null,
        chunkDelayInMs: null,
        ...delays,
      }),
    }),
  });
}

const draft = {
  feature: "draft" as const,
  system: "Answer from the passages.",
  prompt: "How long do refunds take?",
};

async function collect(
  gateway: ReturnType<typeof setup>["gateway"],
  options: { signal?: AbortSignal; onDelta?: (d: string) => void | Promise<void> } = {},
) {
  const deltas: string[] = [];
  const result = await gateway
    .streamText(
      { ...ctx, signal: options.signal },
      {
        ...draft,
        onDelta: async (d) => {
          deltas.push(d);
          await options.onDelta?.(d);
        },
      },
    )
    .catch((e: unknown) => e);
  return { deltas, result };
}

describe("streamText: success", () => {
  it("delivers chunks in order and records time to first token, latency and usage", async () => {
    const model = streaming([...textChunks("Refunds ", "take 5 ", "days [1]."), finish()], {
      chunkDelayInMs: 5,
    });
    const { gateway, records } = setup(model);
    const { deltas, result } = await collect(gateway);
    expect(deltas).toEqual(["Refunds ", "take 5 ", "days [1]."]);
    expect(result).toMatchObject({
      text: "Refunds take 5 days [1].",
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    const row = records[0]!.row;
    expect(row).toMatchObject({ feature: "draft", outcome: "ok", ticketId: "t-1" });
    expect(row.ttftMs).toBeGreaterThanOrEqual(0);
    expect(row.latencyMs).toBeGreaterThanOrEqual(row.ttftMs!);
    const call = model.doStreamCalls[0]!;
    expect(call.maxOutputTokens).toBe(800);
    expect(call.reasoning).toBe("low");
  });

  it("reports a truncated answer (output cap reached) as finishReason length", async () => {
    const { gateway } = setup(streaming([...textChunks("Refunds take"), finish("length")]));
    const { result } = await collect(gateway);
    expect(result).toMatchObject({ finishReason: "length" });
  });
});

describe("streamText: fault injection", () => {
  it("stalled before the first chunk → ai_timeout (firstChunkMs)", async () => {
    const model = streaming([...textChunks("late"), finish()], { initialDelayInMs: 500 });
    const { gateway, records } = setup(model, {
      settings: { draft: { timeout: { totalMs: 5000, firstChunkMs: 50, chunkMs: 5000 } } },
    });
    const { deltas, result } = await collect(gateway);
    expect(result).toMatchObject({ code: "ai_timeout" });
    expect(deltas).toEqual([]);
    expect(records[0]!.row).toMatchObject({
      outcome: "timeout",
      ttftMs: null,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("a request the provider holds before responding → ai_timeout at firstChunkMs, not the total (#96)", async () => {
    // The SDK's own firstChunkMs only starts once doStream has resolved (response headers).
    const model = new MockLanguageModelV4({
      doStream: (options) =>
        new Promise((_, reject) => {
          const signal = options.abortSignal;
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    });
    const { gateway, records } = setup(model, {
      settings: { draft: { timeout: { totalMs: 5000, firstChunkMs: 60, chunkMs: 5000 } } },
    });
    const started = performance.now();
    const { result } = await collect(gateway);
    expect(result).toMatchObject({ code: "ai_timeout" });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(model.doStreamCalls[0]!.abortSignal?.aborted).toBe(true);
    expect(records[0]!.row.outcome).toBe("timeout");
  });

  it("the first-text deadline stops once text arrives: a slow but steady answer completes", async () => {
    const model = streaming([...textChunks("a ", "b ", "c ", "d "), finish()], {
      initialDelayInMs: 10,
      chunkDelayInMs: 40,
    });
    const { gateway } = setup(model, {
      settings: { draft: { timeout: { totalMs: 5000, firstChunkMs: 60, chunkMs: 5000 } } },
    });
    const { result } = await collect(gateway);
    expect(result).toMatchObject({ text: "a b c d ", finishReason: "stop" });
  });

  it("stalled mid-stream → ai_timeout (chunkMs); partial output is estimated, not recorded as free", async () => {
    const model = streaming([...textChunks("Refunds take five days", " and then"), finish()], {
      chunkDelayInMs: 300,
    });
    const { gateway, records } = setup(model, {
      settings: { draft: { timeout: { totalMs: 5000, firstChunkMs: 5000, chunkMs: 100 } } },
    });
    const { result } = await collect(gateway);
    expect(result).toMatchObject({ code: "ai_timeout" });
    expect(records[0]!.row.outcome).toBe("timeout");
    expect(records[0]!.row.outputTokens).toBeGreaterThan(0);
  });

  it("slow but steady past the total limit → ai_timeout (totalMs)", async () => {
    const model = streaming([...textChunks("a ", "b ", "c ", "d ", "e "), finish()], { chunkDelayInMs: 40 });
    const { gateway } = setup(model, {
      settings: { draft: { timeout: { totalMs: 120, firstChunkMs: 5000, chunkMs: 5000 } } },
    });
    const { result } = await collect(gateway);
    expect(result).toMatchObject({ code: "ai_timeout" });
  });

  it("provider error mid-stream → ai_unavailable, never a 'successful' half answer", async () => {
    const model = streaming([
      ...textChunks("Refunds take").slice(0, 2),
      { type: "error", error: apiError(500) },
    ]);
    const { gateway, records } = setup(model);
    const { deltas, result } = await collect(gateway);
    expect(deltas).toEqual(["Refunds take"]);
    expect(result).toBeInstanceOf(AiError);
    expect(result).toMatchObject({ code: "ai_unavailable" });
    expect(records[0]!.row.outcome).toBe("error");
  });

  it("429 when opening the stream → ai_unavailable after one request", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw apiError(429);
      },
    });
    const { gateway } = setup(model);
    const { result } = await collect(gateway);
    expect(result).toMatchObject({ code: "ai_unavailable" });
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("caller aborts mid-stream → ai_aborted, the breaker is not charged", async () => {
    const model = streaming([...textChunks("a ", "b ", "c ", "d "), finish()], { chunkDelayInMs: 50 });
    const { gateway, records } = setup(model);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 80);
    const { result } = await collect(gateway, { signal: controller.signal });
    expect(result).toMatchObject({ code: "ai_aborted" });
    expect(records[0]!.row.outcome).toBe("aborted");
    expect(gateway.circuitState("draft")).toBe("closed");
  });

  it("the client goes away (writing a chunk fails) → ai_aborted and the provider call is cancelled", async () => {
    const model = streaming([...textChunks("a ", "b ", "c "), finish()], { chunkDelayInMs: 20 });
    const { gateway, records } = setup(model);
    const { deltas, result } = await collect(gateway, {
      onDelta: () => {
        throw new Error("socket closed");
      },
    });
    expect(deltas).toEqual(["a "]);
    expect(result).toMatchObject({ code: "ai_aborted" });
    expect(model.doStreamCalls[0]!.abortSignal?.aborted).toBe(true);
    expect(records[0]!.row.outcome).toBe("aborted");
  });

  it("five broken streams open the draft circuit", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw apiError(503);
      },
    });
    const { gateway } = setup(model);
    for (let i = 0; i < 5; i++) await collect(gateway);
    expect(gateway.circuitState("draft")).toBe("open");
    const { result } = await collect(gateway);
    expect(result).toMatchObject({ code: "ai_unavailable" });
    expect(model.doStreamCalls).toHaveLength(5);
  });
});

describe("streamText: fallback model when the first is overloaded (ADR-0016)", () => {
  const throwing = (error: unknown) =>
    new MockLanguageModelV4({
      doStream: async () => {
        throw error;
      },
    });
  const answering = () => streaming([...textChunks("Refunds take ", "5 days [1]."), finish()]);

  it("503 → the fallback answers; both calls are counted, recorded and priced by model", async () => {
    const first = throwing(apiError(503));
    const second = answering();
    const { gateway, records, state, warnings } = setup(first, { fallback: second });
    const { deltas, result } = await collect(gateway);
    expect(result).toMatchObject({ text: "Refunds take 5 days [1].", modelId: FALLBACK_ID });
    expect(deltas).toEqual(["Refunds take ", "5 days [1]."]);
    expect(first.doStreamCalls).toHaveLength(1);
    expect(second.doStreamCalls).toHaveLength(1);
    expect(state.reserved).toBe(2); // the daily cap counts every provider request
    expect(records.map((r) => [r.row.model, r.row.outcome])).toEqual([
      [MOCK_MODEL_ID, "error"],
      [FALLBACK_ID, "ok"],
    ]);
    expect(records[1]!.row.estCostMicros).toBe(100 * 0.3 + 20 * 2.5);
    expect(warnings).toContainEqual(expect.objectContaining({ from: MOCK_MODEL_ID, to: FALLBACK_ID }));
    // The fallback gets the same limits: output cap, thinking level.
    expect(second.doStreamCalls[0]!.maxOutputTokens).toBe(800);
    expect(second.doStreamCalls[0]!.reasoning).toBe("low");
  });

  it("a request held by the provider past firstChunkMs → the fallback answers", async () => {
    const held = new MockLanguageModelV4({
      doStream: (options) =>
        new Promise((_, reject) => {
          options.abortSignal?.addEventListener("abort", () => reject(options.abortSignal!.reason));
        }),
    });
    const { gateway } = setup(held, {
      fallback: answering(),
      settings: { draft: { timeout: { totalMs: 5000, firstChunkMs: 50, chunkMs: 5000 } } },
    });
    const { result } = await collect(gateway);
    expect(result).toMatchObject({ modelId: FALLBACK_ID });
  });

  it("no first chunk in time → the fallback answers", async () => {
    const first = streaming([...textChunks("late"), finish()], { initialDelayInMs: 500 });
    const { gateway } = setup(first, {
      fallback: answering(),
      settings: { draft: { timeout: { totalMs: 5000, firstChunkMs: 50, chunkMs: 5000 } } },
    });
    const { result } = await collect(gateway);
    expect(result).toMatchObject({ modelId: FALLBACK_ID });
  });

  it("429 is never routed round: the rate limit applies to the project", async () => {
    const second = answering();
    const { gateway } = setup(throwing(apiError(429)), { fallback: second });
    const { result } = await collect(gateway);
    expect(result).toMatchObject({ code: "ai_unavailable" });
    expect(second.doStreamCalls).toHaveLength(0);
  });

  it("no fallback once text has reached the agent, for a rejected request, or a cancelled one", async () => {
    const midStream = streaming([
      ...textChunks("Refunds take"),
      { type: "error", error: apiError(503) },
    ] as Chunk[]);
    const second = answering();
    const a = setup(midStream, { fallback: second });
    expect((await collect(a.gateway)).result).toMatchObject({ code: "ai_unavailable" });

    const b = setup(throwing(apiError(400)), { fallback: second });
    expect((await collect(b.gateway)).result).toMatchObject({ code: "ai_rejected" });

    const slow = streaming([...textChunks("a"), finish()], { initialDelayInMs: 200 });
    const c = setup(slow, { fallback: second });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    expect((await collect(c.gateway, { signal: controller.signal })).result).toMatchObject({
      code: "ai_aborted",
    });
    expect(second.doStreamCalls).toHaveLength(0);
  });

  it("the workspace's own limits stop both models", async () => {
    const second = answering();
    const { gateway } = setup(throwing(apiError(503)), {
      fallback: second,
      policy: { tokensUsedThisMonth: 1_000_000 },
    });
    expect((await collect(gateway)).result).toMatchObject({ code: "ai_budget_exhausted" });
    expect(second.doStreamCalls).toHaveLength(0);
  });

  it("with the first model's circuit open, drafts go straight to the fallback, which has its own breaker", async () => {
    const first = throwing(apiError(503));
    const second = answering();
    const { gateway } = setup(first, { fallback: second });
    for (let i = 0; i < 5; i++) await collect(gateway);
    expect(gateway.circuitState("draft")).toBe("open");
    expect(first.doStreamCalls).toHaveLength(5);
    const { result } = await collect(gateway);
    expect(result).toMatchObject({ modelId: FALLBACK_ID });
    expect(first.doStreamCalls).toHaveLength(5); // not called while its circuit is open
    expect(second.doStreamCalls).toHaveLength(6);
  });

  it("both overloaded → the fallback's error, after exactly two requests", async () => {
    const second = throwing(apiError(500));
    const { gateway, state, records } = setup(throwing(apiError(503)), { fallback: second });
    expect((await collect(gateway)).result).toMatchObject({ code: "ai_unavailable" });
    expect(state.reserved).toBe(2);
    expect(records.map((r) => r.row.model)).toEqual([MOCK_MODEL_ID, FALLBACK_ID]);
  });

  it("shouldFallBack: overload, network, timeout and open circuit yes; 429 and everything else no", () => {
    expect(shouldFallBack(new AiError("ai_unavailable", { cause: apiError(503) }))).toBe(true);
    expect(shouldFallBack(new AiError("ai_unavailable"))).toBe(true); // open circuit or network
    expect(shouldFallBack(new AiError("ai_timeout"))).toBe(true);
    expect(shouldFallBack(new AiError("ai_unavailable", { cause: apiError(429) }))).toBe(false);
    for (const code of ["ai_rejected", "ai_invalid_output", "ai_aborted", "ai_daily_limit"] as const) {
      expect(shouldFallBack(new AiError(code))).toBe(false);
    }
    expect(shouldFallBack(new Error("boom"))).toBe(false);
  });
});
