import { APICallError, JSONParseError, NoObjectGeneratedError, RetryError, TypeValidationError } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CircuitBreaker } from "@/server/modules/ai/circuit-breaker";
import { estimateCostMicros, FEATURE_SETTINGS, MOCK_MODEL_ID, PRICES } from "@/server/modules/ai/config";
import { AI_ERROR_CODES, AiError, classifyAiError } from "@/server/modules/ai/errors";
import { createGeminiModels, createMockModels, createModelsFromEnv } from "@/server/modules/ai/models";
import { splitIntoChunks } from "@/server/modules/ai/mock-model";
import { createAiGateway } from "@/server/modules/ai/gateway";

const apiError = (
  statusCode: number | undefined,
  extra: Partial<ConstructorParameters<typeof APICallError>[0]> = {},
) =>
  new APICallError({
    message: "provider said no",
    url: "https://example.test",
    requestBodyValues: {},
    statusCode,
    ...extra,
  });

describe("model config (M5 D1, D2)", () => {
  it("uses stable model IDs, never -latest aliases, with a price for every model now and after 2026", () => {
    for (const settings of Object.values(FEATURE_SETTINGS)) {
      expect(settings.modelId).not.toMatch(/latest/);
      expect(() =>
        estimateCostMicros(settings.modelId, 1, 1, new Date("2026-10-22T12:00:00Z")),
      ).not.toThrow();
      expect(() =>
        estimateCostMicros(settings.modelId, 1, 1, new Date("2027-06-01T12:00:00Z")),
      ).not.toThrow();
    }
  });

  it("pins the plan's limits: output caps, thinking levels and timeouts", () => {
    expect(FEATURE_SETTINGS.triage).toMatchObject({
      maxOutputTokens: 200,
      reasoning: "minimal",
      timeout: { totalMs: 20_000 },
    });
    expect(FEATURE_SETTINGS.draft).toMatchObject({
      maxOutputTokens: 800,
      reasoning: "low",
      timeout: { totalMs: 60_000, firstChunkMs: 15_000, chunkMs: 10_000 },
    });
  });

  it("computes cost in micro-dollars from the dated price table", () => {
    // $0.30 per million input tokens = 0.3 micro-dollars per token.
    expect(estimateCostMicros("gemini-3.5-flash-lite", 1_000_000, 0)).toBe(300_000);
    expect(estimateCostMicros("gemini-3.5-flash-lite", 1000, 100)).toBe(300 + 250);
    // 3.8 Flash: introductory price through 2026-12-31, standard price from 2027-01-01.
    expect(estimateCostMicros("gemini-3.8-flash", 1000, 100, new Date("2026-12-31T23:59:59Z"))).toBe(
      750 + 375,
    );
    expect(estimateCostMicros("gemini-3.8-flash", 1000, 100, new Date("2027-01-01T00:00:00Z"))).toBe(
      1500 + 750,
    );
    expect(estimateCostMicros(MOCK_MODEL_ID, 10_000, 10_000)).toBe(0);
  });

  it("refuses to price an unknown model instead of recording it as free", () => {
    expect(() => estimateCostMicros("gemini-9-ultra", 1, 1)).toThrowError(/No price configured/);
    expect(PRICES.every((p) => p.inputPerMillion >= 0 && p.outputPerMillion >= 0)).toBe(true);
  });
});

describe("classifyAiError", () => {
  const classify = (err: unknown, clientAborted = false) => classifyAiError(err, { clientAborted }).code;

  it.each([
    [429, "ai_unavailable"],
    [408, "ai_unavailable"],
    [500, "ai_unavailable"],
    [503, "ai_unavailable"],
    [400, "ai_rejected"],
    [401, "ai_rejected"],
    [403, "ai_rejected"],
    [404, "ai_rejected"],
    [200, "ai_invalid_output"],
  ] as const)("HTTP %i → %s", (status, code) => {
    expect(classify(apiError(status))).toBe(code);
  });

  it("treats a retryable network failure without a status as temporary, a non-retryable one as rejected", () => {
    expect(classify(apiError(undefined, { isRetryable: true }))).toBe("ai_unavailable");
    expect(classify(apiError(undefined, { isRetryable: false }))).toBe("ai_rejected");
    expect(classify(new TypeError("fetch failed"))).toBe("ai_unavailable");
  });

  it("unwraps RetryError to the last provider error", () => {
    const retry = new RetryError({
      message: "gave up",
      reason: "maxRetriesExceeded",
      errors: [apiError(500), apiError(401)],
    });
    expect(classify(retry)).toBe("ai_rejected");
  });

  it("maps unparseable and schema-invalid output to ai_invalid_output", () => {
    const parse = new JSONParseError({ text: "not json", cause: new Error("x") });
    const invalid = new TypeValidationError({ value: {}, cause: new Error("x") });
    expect(classify(parse)).toBe("ai_invalid_output");
    expect(classify(invalid)).toBe("ai_invalid_output");
    expect(
      classify(
        new NoObjectGeneratedError({
          message: "no",
          text: "x",
          response: { id: "r", timestamp: new Date(), modelId: "m" },
          usage: {} as never,
          finishReason: "stop",
        }),
      ),
    ).toBe("ai_invalid_output");
  });

  it("tells a timeout from a cancellation only through the caller's own signal", () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const abort = new DOMException("This operation was aborted", "AbortError");
    expect(classify(timeout)).toBe("ai_timeout");
    expect(classify(abort)).toBe("ai_unavailable");
    expect(classify(abort, true)).toBe("ai_aborted");
    expect(classify(apiError(500), true)).toBe("ai_aborted");
  });

  it("reads Retry-After in seconds or as an HTTP date", () => {
    const seconds = classifyAiError(apiError(429, { responseHeaders: { "retry-after": "7" } }), {
      clientAborted: false,
    });
    expect(seconds.retryAfterMs).toBe(7000);
    const date = new Date(Date.now() + 30_000).toUTCString();
    const dated = classifyAiError(apiError(429, { responseHeaders: { "retry-after": date } }), {
      clientAborted: false,
    });
    expect(dated.retryAfterMs).toBeGreaterThan(20_000);
    expect(dated.retryAfterMs).toBeLessThanOrEqual(30_000);
    const junk = classifyAiError(apiError(429, { responseHeaders: { "retry-after": "soon" } }), {
      clientAborted: false,
    });
    expect(junk.retryAfterMs).toBeUndefined();
  });

  it("passes AiErrors through and maps every code to a usage outcome", () => {
    const original = new AiError("ai_budget_exhausted");
    expect(classifyAiError(original, { clientAborted: true })).toBe(original);
    const outcomes = Object.fromEntries(AI_ERROR_CODES.map((c) => [c, new AiError(c).outcome]));
    expect(outcomes).toEqual({
      ai_disabled: "error",
      ai_budget_exhausted: "error",
      ai_daily_limit: "error",
      ai_unavailable: "error",
      ai_timeout: "timeout",
      ai_invalid_output: "invalid",
      ai_rejected: "error",
      ai_aborted: "aborted",
    });
    expect(AI_ERROR_CODES.filter((c) => new AiError(c).temporary)).toEqual(["ai_unavailable", "ai_timeout"]);
  });
});

describe("CircuitBreaker (D13)", () => {
  const make = () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => now });
    return { breaker, advance: (ms: number) => (now += ms) };
  };

  it("opens after N consecutive failures and refuses with the time left", () => {
    const { breaker, advance } = make();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state).toBe("closed");
    breaker.recordFailure();
    expect(breaker.state).toBe("open");
    advance(400);
    expect(breaker.acquire()).toEqual({ allowed: false, retryAfterMs: 600 });
  });

  it("only counts consecutive failures", () => {
    const { breaker } = make();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state).toBe("closed");
  });

  it("allows exactly one trial after the cooldown; success closes, failure re-opens", () => {
    const { breaker, advance } = make();
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    advance(1000);
    expect(breaker.state).toBe("half-open");
    expect(breaker.acquire().allowed).toBe(true);
    expect(breaker.acquire().allowed).toBe(false); // trial in flight
    breaker.recordFailure();
    expect(breaker.state).toBe("open"); // a single failure re-opens it
    advance(1000);
    expect(breaker.acquire().allowed).toBe(true);
    breaker.recordSuccess();
    expect(breaker.state).toBe("closed");
    expect(breaker.acquire().allowed).toBe(true);
  });

  it("frees the trial slot when a call ends without a verdict (cancelled)", () => {
    const { breaker, advance } = make();
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    advance(1000);
    expect(breaker.acquire().allowed).toBe(true);
    breaker.release();
    expect(breaker.state).toBe("half-open");
    expect(breaker.acquire().allowed).toBe(true);
  });

  it("rejects a threshold below 1", () => {
    expect(() => new CircuitBreaker({ failureThreshold: 0, cooldownMs: 1 })).toThrowError(RangeError);
  });
});

describe("mock provider (D3)", () => {
  const ledger = {
    getPolicy: async () => ({ aiEnabled: true, monthlyTokenBudget: 1_000_000, tokensUsedThisMonth: 0 }),
    reserveDailyCall: async () => true,
    recordUsage: async () => {},
  };

  it("splits text into word chunks without losing any characters", () => {
    const text = "  Hello there, this is a  streamed\nanswer [1].";
    const chunks = splitIntoChunks(text, 3);
    expect(chunks.join("")).toBe(text);
    expect(chunks.length).toBe(3);
    expect(splitIntoChunks("")).toEqual([]);
    expect(splitIntoChunks("   ")).toEqual(["   "]);
  });

  it("hands the responder the system text, prompt and requested JSON schema, and validates its answer", async () => {
    const seen: unknown[] = [];
    const models = createMockModels({
      triage: (request) => {
        seen.push(request);
        return JSON.stringify({ category: "billing" });
      },
    });
    const gateway = createAiGateway({ models, ledger, dailyCallLimit: 10 });
    const schema = z.object({ category: z.enum(["billing", "bug"]) });
    const result = await gateway.generateObject(
      { workspaceId: "w" },
      { feature: "triage", system: "S", prompt: "P", schema },
    );
    expect(result.object).toEqual({ category: "billing" });
    expect(result.modelId).toBe(MOCK_MODEL_ID);
    expect(result.usage.estCostMicros).toBe(0);
    expect(seen[0]).toMatchObject({ system: "S", prompt: "P", json: true });
    expect(JSON.stringify((seen[0] as { schema: unknown }).schema)).toContain("billing");
  });

  it("streams the responder's text in chunks", async () => {
    const models = createMockModels({ draft: () => "One two three four five six seven." });
    const gateway = createAiGateway({ models, ledger, dailyCallLimit: 10 });
    const deltas: string[] = [];
    const result = await gateway.streamText(
      { workspaceId: "w" },
      { feature: "draft", system: "S", prompt: "P", onDelta: (d) => void deltas.push(d) },
    );
    expect(deltas.length).toBe(3);
    expect(deltas.join("")).toBe("One two three four five six seven.");
    expect(result.text).toBe(deltas.join(""));
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it("placeholder JSON fails a real schema loudly rather than passing by accident", async () => {
    const gateway = createAiGateway({ models: createMockModels(), ledger, dailyCallLimit: 10 });
    const schema = z.object({ category: z.string() });
    await expect(
      gateway.generateObject({ workspaceId: "w" }, { feature: "triage", system: "", prompt: "x", schema }),
    ).rejects.toMatchObject({ code: "ai_invalid_output" });
  });
});

describe("provider selection", () => {
  it("uses the mock unless gemini is chosen, and gemini needs a key", () => {
    expect(createModelsFromEnv({ AI_PROVIDER: "mock" }).provider).toBe("mock");
    expect(() => createModelsFromEnv({ AI_PROVIDER: "gemini" })).toThrowError(/GEMINI_API_KEY/);
    const gemini = createModelsFromEnv({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "test-key" });
    expect(gemini.provider).toBe("gemini");
    expect(gemini.models.triage.modelId).toBe("gemini-3.5-flash-lite");
    expect(gemini.models.draft.modelId).toBe("gemini-3.8-flash");
  });
});

/**
 * The exact request the Gemini provider sends, captured with a fake fetch (no network, no
 * quota). Confirms the thinking levels (D2), output caps (D12d) and JSON mode reach Google.
 */
/** The parts of a Gemini generateContent request body these tests read. */
interface GeminiRequestBody {
  generationConfig: {
    maxOutputTokens?: number;
    thinkingConfig?: unknown;
    responseMimeType?: string;
    responseSchema?: unknown;
    responseJsonSchema?: unknown;
  };
}

describe("Gemini request shape", () => {
  const usageMetadata = { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150 };
  const ledger = {
    getPolicy: async () => ({ aiEnabled: true, monthlyTokenBudget: 1_000_000, tokensUsedThisMonth: 0 }),
    reserveDailyCall: async () => true,
    recordUsage: async () => {},
  };

  function capture(response: () => Response) {
    const requests: Array<{ url: string; body: GeminiRequestBody }> = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return response();
    }) as typeof globalThis.fetch;
    return { requests, fetch };
  }

  it("triage: flash-lite, minimal thinking, 200 output tokens, JSON with the schema; cost from Google's token counts", async () => {
    const { requests, fetch } = capture(
      () =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { role: "model", parts: [{ text: '{"category":"bug"}' }] }, finishReason: "STOP" },
            ],
            usageMetadata,
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const gateway = createAiGateway({
      models: createGeminiModels({ apiKey: "test-key", fetch }),
      ledger,
      dailyCallLimit: 10,
    });
    const result = await gateway.generateObject(
      { workspaceId: "w" },
      {
        feature: "triage",
        system: "Classify.",
        prompt: "My app crashes",
        schema: z.object({ category: z.enum(["bug", "billing"]) }),
      },
    );
    expect(result.object).toEqual({ category: "bug" });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toContain("models/gemini-3.5-flash-lite:generateContent");
    const config = requests[0]!.body.generationConfig;
    expect(config.maxOutputTokens).toBe(200);
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
    expect(config.responseMimeType).toBe("application/json");
    expect(JSON.stringify(config.responseSchema ?? config.responseJsonSchema)).toContain("billing");
    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      estCostMicros: Math.round(120 * 0.3 + 30 * 2.5),
    });
  });

  it("drafts: 3.8 Flash streamed, low thinking, 800 output tokens", async () => {
    const sse = [
      { candidates: [{ content: { role: "model", parts: [{ text: "Refunds take " }] } }] },
      {
        candidates: [{ content: { role: "model", parts: [{ text: "5 days [1]." }] }, finishReason: "STOP" }],
        usageMetadata,
      },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("");
    const { requests, fetch } = capture(
      () => new Response(sse, { headers: { "content-type": "text/event-stream" } }),
    );
    const gateway = createAiGateway({
      models: createGeminiModels({ apiKey: "test-key", fetch }),
      ledger,
      dailyCallLimit: 10,
    });
    const deltas: string[] = [];
    const result = await gateway.streamText(
      { workspaceId: "w" },
      { feature: "draft", system: "Answer.", prompt: "Refund time?", onDelta: (d) => void deltas.push(d) },
    );
    expect(deltas).toEqual(["Refunds take ", "5 days [1]."]);
    expect(result).toMatchObject({ text: "Refunds take 5 days [1].", finishReason: "stop" });
    expect(requests[0]!.url).toContain("models/gemini-3.8-flash:streamGenerateContent");
    expect(requests[0]!.body.generationConfig).toMatchObject({
      maxOutputTokens: 800,
      thinkingConfig: { thinkingLevel: "low" },
    });
  });
});
