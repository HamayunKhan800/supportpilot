/**
 * Every model choice, limit and price for text generation, in one place (M5 D1, D2, D12;
 * ADR-0015). Changing a model is a one-line change here plus a price row.
 */

export const AI_FEATURES = ["triage", "draft"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/**
 * The AI SDK's provider-neutral reasoning setting. The Google provider maps it to Gemini's
 * `thinkingLevel` and raises it to the lowest level each model accepts (e.g. "minimal" becomes
 * "low" on gemini-3.8-flash, which rejects "minimal"). @ai-sdk/google 4.0.97,
 * getMinimumThinkingLevelForGemini3Model.
 */
type Reasoning = "minimal" | "low" | "medium" | "high";

export interface FeatureSettings {
  /** Stable model ID, never a `-latest` alias (aliases change without notice). */
  modelId: string;
  reasoning: Reasoning;
  /** Hard cap on generated tokens (D12d). Thinking tokens are billed as output. */
  maxOutputTokens: number;
  /** AI SDK timeouts (D12e). `firstChunkMs`/`chunkMs` apply to streaming only. */
  timeout: { totalMs: number; firstChunkMs?: number; chunkMs?: number };
  /**
   * A second model for streamed text when the first is overloaded (ADR-0016): used only for a
   * provider-side failure (5xx, network, timeout, open circuit) before any text arrived, never
   * for 429 "too many requests". Same output cap, thinking level and timeouts.
   */
  fallbackModelId?: string;
}

export const FEATURE_SETTINGS: Record<AiFeature, FeatureSettings> = {
  // Short structured answer: cheapest current model, least thinking.
  triage: {
    modelId: "gemini-3.5-flash-lite",
    reasoning: "minimal",
    maxOutputTokens: 200,
    timeout: { totalMs: 20_000 },
  },
  // Customer-facing prose with citations: the stronger model, low thinking.
  draft: {
    modelId: "gemini-3.8-flash",
    reasoning: "low",
    maxOutputTokens: 800,
    timeout: { totalMs: 60_000, firstChunkMs: 15_000, chunkMs: 10_000 },
    // 3.8 Flash answered "503 high demand" for a whole session (finding #95); drafts then use
    // the triage model rather than failing.
    fallbackModelId: "gemini-3.5-flash-lite",
  },
};

/** Model ID recorded for the offline mock provider. Costs nothing. */
export const MOCK_MODEL_ID = "mock-llm";

/** Circuit breaker (D13): after this many consecutive provider failures, stop calling for a while. */
export const CIRCUIT_BREAKER = { failureThreshold: 5, cooldownMs: 60_000 } as const;

/** Counter scope in ai_daily_calls shared by all generation features (D12b). */
export const DAILY_CALL_SCOPE = "generation";

/**
 * Paid-tier list prices in US dollars per million tokens, from
 * https://ai.google.dev/gemini-api/docs/pricing (checked 2026-10-22). The free tier costs
 * nothing; these figures are what the same traffic would cost on the paid tier, which is
 * what the evaluation reports. `until` is the last day (UTC) a price applies.
 */
export const PRICES: ReadonlyArray<{
  modelId: string;
  inputPerMillion: number;
  outputPerMillion: number;
  until?: string;
}> = [
  // Introductory price until the end of 2026, then the standard price.
  { modelId: "gemini-3.8-flash", inputPerMillion: 0.75, outputPerMillion: 3.75, until: "2026-12-31" },
  { modelId: "gemini-3.8-flash", inputPerMillion: 1.5, outputPerMillion: 7.5 },
  { modelId: "gemini-3.5-flash-lite", inputPerMillion: 0.3, outputPerMillion: 2.5 },
  { modelId: MOCK_MODEL_ID, inputPerMillion: 0, outputPerMillion: 0 },
];

/**
 * Estimated cost in micro-dollars (integer, as stored in ai_usage). At $1 per million tokens one
 * token costs one micro-dollar, so the price per million is also the micro-dollars per token.
 * Unknown models throw: a missing price must be noticed, not recorded as free.
 */
export function estimateCostMicros(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  at: Date = new Date(),
): number {
  const day = at.toISOString().slice(0, 10);
  const price = PRICES.find((p) => p.modelId === modelId && (p.until === undefined || day <= p.until));
  if (!price) throw new Error(`No price configured for model "${modelId}" (src/server/modules/ai/config.ts)`);
  return Math.round(inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion);
}
