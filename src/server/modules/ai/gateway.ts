import { generateText, NoObjectGeneratedError, Output, streamText, type LanguageModelUsage } from "ai";
import type { z } from "zod";
import type { AiUsageOutcome } from "@/server/platform/db/schema";
import type { Executor } from "@/server/platform/db/tx";
import { logger as defaultLogger } from "@/server/platform/logger";
import { annotateActiveSpan, SPAN_ATTRIBUTES, withSpan } from "@/server/platform/telemetry/spans";
import { CircuitBreaker, type CircuitState } from "./circuit-breaker";
import {
  AI_FEATURES,
  CIRCUIT_BREAKER,
  DAILY_CALL_SCOPE,
  estimateCostMicros,
  FEATURE_SETTINGS,
  type AiFeature,
  type FeatureSettings,
} from "./config";
import { AiError, classifyAiError } from "./errors";
import { createModelsFromEnv, type AiModels } from "./models";
import type { MockResponder } from "./mock-model";
import {
  getAiPolicy,
  insertAiUsageRecord,
  releaseDailyCall,
  reserveDailyCall,
  type AiPolicy,
  type AiUsageRecord,
} from "./repository";

/**
 * The only way the app calls a language model (M5 D3, D12–D14; ADR-0015). Every call, in order:
 *
 *  1. AI enabled for the workspace?            no → ai_disabled
 *  2. Monthly token budget left?               no → ai_budget_exhausted   (FR-AI7)
 *  3. Circuit closed for this model?           no → ai_unavailable        (D13)
 *  4. Reserve a slot in the daily cap          full → ai_daily_limit      (D12b)
 *  5. Call the model: no SDK retries, timeouts, output cap, caller's abort signal
 *  6. Record outcome, tokens, cost, latency and time to first token in ai_usage (D14)
 *
 * Streamed text may then be tried once on a fallback model (ADR-0016) when the first failed on
 * the provider's side (never for a 429) before any text arrived; that attempt runs steps 1–6
 * again, with its own circuit breaker.
 *
 * Steps 1–4 run before any network call, so a refused call costs nothing. SDK retries are off
 * (maxRetries: 0) so each provider request is counted once by the cap and seen by the breaker;
 * callers that should retry (the triage job) retry with their own back-off.
 *
 * Prompts and outputs are never logged (D11) and never traced: each attempt is one span holding
 * metadata only (feature, model, outcome, tokens, cost, latency), and the AI SDK's own
 * telemetry is switched off on every call (`telemetry: { isEnabled: false }`), because once any
 * integration is registered it records full prompts and outputs by default (AI SDK telemetry
 * docs; plan M6 D8, ADR-0018).
 */

/** Per call: the AI SDK's telemetry stays off, so it can never record a prompt or an output. */
const SDK_TELEMETRY_OFF = { isEnabled: false } as const;

export interface AiCallContext {
  workspaceId: string;
  /** Recorded with the usage row for per-ticket cost. */
  ticketId?: string | null;
  /** Cancels the call, e.g. when the agent closes the page (D13). */
  signal?: AbortSignal;
}

interface AiRequest {
  feature: AiFeature;
  system: string;
  prompt: string;
}

export interface AiUsageSummary {
  inputTokens: number;
  outputTokens: number;
  estCostMicros: number;
}

export interface AiObjectResult<T> {
  object: T;
  modelId: string;
  usage: AiUsageSummary;
  latencyMs: number;
}

export interface AiTextResult {
  text: string;
  modelId: string;
  usage: AiUsageSummary;
  latencyMs: number;
  /** Milliseconds to the first text chunk; null if the model returned no text. */
  ttftMs: number | null;
  /** "stop" normally; "length" means the output cap cut the text short. */
  finishReason: string;
}

/** Storage the gateway needs. Postgres in the app; an in-memory fake in unit tests. */
export interface AiLedger {
  getPolicy(workspaceId: string): Promise<AiPolicy | null>;
  reserveDailyCall(limit: number): Promise<boolean>;
  /** Gives one reserved call back (the provider rejected it). Optional for test fakes. */
  releaseDailyCall?(): Promise<void>;
  recordUsage(workspaceId: string, row: AiUsageRecord): Promise<void>;
}

export function createPostgresLedger(db: Executor): AiLedger {
  return {
    getPolicy: (workspaceId) => getAiPolicy(db, workspaceId),
    reserveDailyCall: (limit) => reserveDailyCall(db, DAILY_CALL_SCOPE, limit),
    releaseDailyCall: () => releaseDailyCall(db, DAILY_CALL_SCOPE),
    recordUsage: (workspaceId, row) => insertAiUsageRecord(db, workspaceId, row),
  };
}

export interface AiGateway {
  readonly provider: AiModels["provider"];
  /** Structured output validated against `schema` (Zod). Invalid output → ai_invalid_output. */
  generateObject<T>(
    ctx: AiCallContext,
    request: AiRequest & { schema: z.ZodType<T> },
  ): Promise<AiObjectResult<T>>;
  /**
   * Streams text, calling `onDelta` for each chunk (awaited, so a slow client applies
   * back-pressure). Resolves after the last chunk; rejects with an AiError on any failure,
   * including mid-stream ones, which the AI SDK reports as stream parts rather than throwing.
   */
  streamText(
    ctx: AiCallContext,
    request: AiRequest & { onDelta: (text: string) => void | Promise<void> },
  ): Promise<AiTextResult>;
  circuitState(feature: AiFeature): CircuitState;
}

export interface AiGatewayOptions {
  models: AiModels;
  ledger: AiLedger;
  /** AI_DAILY_CALL_LIMIT. */
  dailyCallLimit: number;
  /** Test hooks: shorter timeouts, a fake clock, a quiet logger. */
  settings?: Partial<Record<AiFeature, Partial<FeatureSettings>>>;
  clock?: () => number;
  breakerClock?: () => number;
  logger?: Pick<typeof defaultLogger, "warn">;
}

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function createAiGateway(options: AiGatewayOptions): AiGateway {
  const { models, ledger, dailyCallLimit } = options;
  const clock = options.clock ?? (() => performance.now());
  const log = options.logger ?? defaultLogger;
  const settingsFor = (feature: AiFeature): FeatureSettings => ({
    ...FEATURE_SETTINGS[feature],
    ...options.settings?.[feature],
  });
  const newBreakers = () =>
    Object.fromEntries(
      AI_FEATURES.map((feature) => [
        feature,
        new CircuitBreaker({ ...CIRCUIT_BREAKER, now: options.breakerClock }),
      ]),
    ) as Record<AiFeature, CircuitBreaker>;
  // One breaker per model: an overloaded first model must not hold back its fallback.
  const breakers = newBreakers();
  const fallbackBreakers = newBreakers();

  /** Steps 1–4. Throws an AiError without calling the provider. */
  async function admit(
    ctx: AiCallContext,
    feature: AiFeature,
    breaker: CircuitBreaker = breakers[feature],
  ): Promise<void> {
    if (ctx.signal?.aborted) throw new AiError("ai_aborted");
    const policy = await ledger.getPolicy(ctx.workspaceId);
    if (!policy?.aiEnabled) throw new AiError("ai_disabled");
    if (policy.tokensUsedThisMonth >= policy.monthlyTokenBudget) throw new AiError("ai_budget_exhausted");
    const permit = breaker.acquire();
    if (!permit.allowed) throw new AiError("ai_unavailable", { retryAfterMs: permit.retryAfterMs });
    let reserved: boolean;
    try {
      reserved = await ledger.reserveDailyCall(dailyCallLimit);
    } catch (err) {
      breaker.release();
      throw err;
    }
    if (!reserved) {
      breaker.release();
      throw new AiError("ai_daily_limit");
    }
  }

  function summarize(modelId: string, input: number, output: number): AiUsageSummary {
    return {
      inputTokens: input,
      outputTokens: output,
      estCostMicros: estimateCostMicros(modelId, input, output),
    };
  }

  function fromSdkUsage(modelId: string, usage: LanguageModelUsage | undefined): AiUsageSummary {
    return summarize(modelId, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0);
  }

  /** Step 6 plus the breaker update. Never throws: a logging failure must not hide the call's result. */
  async function settle(
    ctx: AiCallContext,
    feature: AiFeature,
    modelId: string,
    result: { error?: AiError; usage: AiUsageSummary; latencyMs: number; ttftMs?: number | null },
    breaker: CircuitBreaker = breakers[feature],
  ): Promise<void> {
    const code = result.error?.code;
    if (code === "ai_unavailable" || code === "ai_timeout" || code === "ai_rejected") breaker.recordFailure();
    else if (code === "ai_aborted") breaker.release();
    else breaker.recordSuccess(); // ok, or invalid output: the provider answered

    const outcome: AiUsageOutcome = result.error?.outcome ?? "ok";
    annotateActiveSpan({
      [SPAN_ATTRIBUTES.aiOutcome]: outcome,
      [SPAN_ATTRIBUTES.genAiInputTokens]: result.usage.inputTokens,
      [SPAN_ATTRIBUTES.genAiOutputTokens]: result.usage.outputTokens,
      [SPAN_ATTRIBUTES.aiCostMicros]: result.usage.estCostMicros,
      [SPAN_ATTRIBUTES.aiLatencyMs]: Math.round(result.latencyMs),
      ...(result.ttftMs == null ? {} : { [SPAN_ATTRIBUTES.aiTtftMs]: Math.round(result.ttftMs) }),
    });
    if (result.error) {
      const cause = result.error.cause as { statusCode?: unknown; name?: unknown } | undefined;
      log.warn(
        {
          feature,
          workspaceId: ctx.workspaceId,
          code,
          provider: models.provider,
          model: modelId,
          status: typeof cause?.statusCode === "number" ? cause.statusCode : undefined,
          causeName: typeof cause?.name === "string" ? cause.name : undefined,
          circuit: breaker.state,
        },
        "ai call failed",
      );
    }
    // A rejected call (bad or damaged key, bad request) used none of the provider's quota, so it
    // doesn't count against the daily cap. Overloads, rate limits and timeouts stay counted.
    if (code === "ai_rejected" && ledger.releaseDailyCall) {
      try {
        await ledger.releaseDailyCall();
      } catch (err) {
        log.warn({ feature, workspaceId: ctx.workspaceId, err }, "could not release the daily call");
      }
    }
    try {
      await ledger.recordUsage(ctx.workspaceId, {
        feature,
        model: modelId,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        estCostMicros: result.usage.estCostMicros,
        outcome,
        latencyMs: Math.round(result.latencyMs),
        ttftMs: result.ttftMs == null ? null : Math.round(result.ttftMs),
        ticketId: ctx.ticketId ?? null,
      });
    } catch (err) {
      log.warn({ feature, workspaceId: ctx.workspaceId, err }, "could not record ai usage");
    }
  }

  /** One span per attempt (see the module comment): ids and the model, never text. */
  function traceAttempt<T>(
    ctx: AiCallContext,
    feature: AiFeature,
    modelId: string,
    isFallback: boolean,
    run: () => Promise<T>,
  ): Promise<T> {
    return withSpan(
      `ai ${feature}`,
      {
        [SPAN_ATTRIBUTES.aiFeature]: feature,
        [SPAN_ATTRIBUTES.genAiOperation]: "generate_content",
        [SPAN_ATTRIBUTES.genAiProvider]: models.provider,
        [SPAN_ATTRIBUTES.genAiModel]: modelId,
        [SPAN_ATTRIBUTES.aiFallback]: isFallback,
        [SPAN_ATTRIBUTES.workspaceId]: ctx.workspaceId,
        ...(ctx.ticketId ? { [SPAN_ATTRIBUTES.ticketId]: ctx.ticketId } : {}),
      },
      run,
    );
  }

  return {
    provider: models.provider,

    circuitState: (feature) => breakers[feature].state,

    generateObject<T>(ctx: AiCallContext, request: AiRequest & { schema: z.ZodType<T> }) {
      return traceAttempt(ctx, request.feature, models.models[request.feature].modelId, false, () =>
        generateObjectOnce(ctx, request),
      );
    },

    async streamText(ctx, request) {
      const { feature } = request;
      const fallback = models.fallbacks?.[feature];
      let delivered = false;
      const tracked = {
        ...request,
        onDelta: (text: string) => {
          delivered = true;
          return request.onDelta(text);
        },
      };
      const first = models.models[feature];
      try {
        return await traceAttempt(ctx, feature, first.modelId, false, () =>
          streamOnce(ctx, tracked, { ...first, breaker: breakers[feature] }),
        );
      } catch (err) {
        if (!fallback || delivered || !shouldFallBack(err)) throw err;
        log.warn(
          {
            feature,
            workspaceId: ctx.workspaceId,
            code: err instanceof AiError ? err.code : undefined,
            from: first.modelId,
            to: fallback.modelId,
          },
          "ai call falling back to the second model",
        );
        return traceAttempt(ctx, feature, fallback.modelId, true, () =>
          streamOnce(ctx, tracked, { ...fallback, breaker: fallbackBreakers[feature] }),
        );
      }
    },
  };

  /** One structured-output call: steps 1–6. */
  async function generateObjectOnce<T>(
    ctx: AiCallContext,
    request: AiRequest & { schema: z.ZodType<T> },
  ): Promise<AiObjectResult<T>> {
    {
      const { feature } = request;
      await admit(ctx, feature);
      const settings = settingsFor(feature);
      const { model, modelId } = models.models[feature];
      const started = clock();
      let output: T;
      let usage: AiUsageSummary;
      try {
        const result = await generateText({
          model,
          system: request.system,
          prompt: request.prompt,
          output: Output.object({ schema: request.schema }),
          maxOutputTokens: settings.maxOutputTokens,
          reasoning: settings.reasoning,
          maxRetries: 0,
          abortSignal: ctx.signal,
          timeout: { totalMs: settings.timeout.totalMs },
          telemetry: SDK_TELEMETRY_OFF,
        });
        output = result.output as T;
        usage = fromSdkUsage(modelId, result.totalUsage);
      } catch (err) {
        const error = classifyAiError(err, { clientAborted: ctx.signal?.aborted ?? false });
        // Invalid output was still generated, and billed: record its tokens.
        const failedUsage = NoObjectGeneratedError.isInstance(err) ? err.usage : undefined;
        await settle(ctx, feature, modelId, {
          error,
          usage: fromSdkUsage(modelId, failedUsage),
          latencyMs: clock() - started,
        });
        throw error;
      }
      const latencyMs = clock() - started;
      await settle(ctx, feature, modelId, { usage, latencyMs });
      return { object: output, modelId, usage, latencyMs };
    }
  }

  /** One streamed call to one model: steps 1–6. */
  async function streamOnce(
    ctx: AiCallContext,
    request: AiRequest & { onDelta: (text: string) => void | Promise<void> },
    slot: { model: AiModels["models"][AiFeature]["model"]; modelId: string; breaker: CircuitBreaker },
  ): Promise<AiTextResult> {
    {
      const { feature } = request;
      const { model, modelId, breaker } = slot;
      await admit(ctx, feature, breaker);
      const settings = settingsFor(feature);
      // Ours aborts the provider call when we stop early (delivery failed, error part).
      const internal = new AbortController();
      const signal = ctx.signal ? AbortSignal.any([ctx.signal, internal.signal]) : internal.signal;
      const started = clock();

      let text = "";
      let ttftMs: number | null = null;
      let failure: unknown;
      let failed = false;
      let deliveryFailed = false;
      let abortReason: string | undefined;
      let sdkAborted = false;
      let finish: { finishReason: string; totalUsage: LanguageModelUsage } | undefined;

      // The SDK's firstChunkMs only starts once the provider begins its HTTP response (ai 7.0.142,
      // streamText: `await callLanguageModel()` runs before `startFirstChunkTimeout()`), so a
      // request the provider holds in a queue waits for the total timeout (finding #96). This
      // deadline runs from the moment the request is sent until the first text arrives.
      let noTextInTime = false;
      const firstTextMs = settings.timeout.firstChunkMs;
      let firstTextTimer: ReturnType<typeof setTimeout> | undefined =
        firstTextMs === undefined
          ? undefined
          : setTimeout(() => {
              noTextInTime = true;
              internal.abort();
            }, firstTextMs);
      const stopFirstTextTimer = () => {
        clearTimeout(firstTextTimer);
        firstTextTimer = undefined;
      };

      const result = streamText({
        model,
        system: request.system,
        prompt: request.prompt,
        maxOutputTokens: settings.maxOutputTokens,
        reasoning: settings.reasoning,
        maxRetries: 0,
        abortSignal: signal,
        timeout: settings.timeout,
        // Errors arrive as stream parts and are handled below; this stops the SDK's console logging.
        onError: () => {},
        telemetry: SDK_TELEMETRY_OFF,
      });

      try {
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            stopFirstTextTimer();
            if (ttftMs === null) ttftMs = clock() - started;
            text += part.text;
            try {
              await request.onDelta(part.text);
            } catch (err) {
              deliveryFailed = true;
              failed = true;
              failure = err;
              break;
            }
          } else if (part.type === "error") {
            failed = true;
            failure = part.error;
            break;
          } else if (part.type === "abort") {
            sdkAborted = true;
            abortReason = part.reason;
            break;
          } else if (part.type === "finish") {
            finish = { finishReason: part.finishReason, totalUsage: part.totalUsage };
          }
        }
      } catch (err) {
        failed = true;
        failure = err;
      } finally {
        stopFirstTextTimer();
        if (!finish) internal.abort();
      }

      const latencyMs = clock() - started;
      let error: AiError | undefined;
      const clientAborted = (ctx.signal?.aborted ?? false) || deliveryFailed;
      if (noTextInTime && ttftMs === null && !clientAborted) {
        error = new AiError("ai_timeout", { cause: new Error("no text before the first-chunk deadline") });
      } else if (failed) error = classifyAiError(failure, { clientAborted });
      else if (sdkAborted) {
        error = clientAborted
          ? new AiError("ai_aborted", { cause: new Error(abortReason ?? "aborted") })
          : new AiError("ai_timeout", { cause: new Error(abortReason ?? "timeout") });
      } else if (!finish)
        error = new AiError("ai_unavailable", { cause: new Error("stream ended without finishing") });

      if (error) {
        // The provider doesn't report usage for a broken stream. If it had started answering, it
        // processed the prompt and generated the partial text: estimate both, so cost isn't hidden.
        const usage =
          text.length > 0
            ? summarize(modelId, estimateTokens(request.system + request.prompt), estimateTokens(text))
            : summarize(modelId, 0, 0);
        await settle(ctx, feature, modelId, { error, usage, latencyMs, ttftMs }, breaker);
        throw error;
      }

      const usage = fromSdkUsage(modelId, finish?.totalUsage);
      annotateActiveSpan({ [SPAN_ATTRIBUTES.genAiFinishReasons]: [finish?.finishReason ?? "other"] });
      await settle(ctx, feature, modelId, { usage, latencyMs, ttftMs }, breaker);
      return { text, modelId, usage, latencyMs, ttftMs, finishReason: finish?.finishReason ?? "other" };
    }
  }
}

/**
 * Whether a failed call may be repeated on the fallback model (ADR-0016): the provider was
 * overloaded or unreachable (5xx, network, open circuit) or gave no answer in time. Never for
 * 429: a rate limit applies to the project, and switching models to get round it would
 * circumvent the provider's limits. Never for the caller's own limits, a rejected request
 * (the same request would be rejected again), invalid output or a cancelled call.
 */
export function shouldFallBack(err: unknown): boolean {
  if (!(err instanceof AiError)) return false;
  if (err.code === "ai_timeout") return true;
  if (err.code !== "ai_unavailable") return false;
  const status = (err.cause as { statusCode?: unknown } | undefined)?.statusCode;
  return status !== 429;
}

/** Wires the gateway from validated settings. Create one per process: the circuit breakers live in it. */
export function createAiGatewayFromEnv(
  env: { AI_PROVIDER: "mock" | "gemini"; GEMINI_API_KEY?: string | undefined; AI_DAILY_CALL_LIMIT: number },
  db: Executor,
  mockResponders: Partial<Record<AiFeature, MockResponder>> = {},
): AiGateway {
  return createAiGateway({
    models: createModelsFromEnv(env, mockResponders),
    ledger: createPostgresLedger(db),
    dailyCallLimit: env.AI_DAILY_CALL_LIMIT,
  });
}
