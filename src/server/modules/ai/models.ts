import { createGoogle } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { AI_FEATURES, FEATURE_SETTINGS, MOCK_MODEL_ID, type AiFeature } from "./config";
import { createMockLanguageModel, type MockResponder } from "./mock-model";

/** One language model per feature, plus the ID recorded in ai_usage (ADR-0006, M5 D3). */
export interface AiModels {
  provider: "mock" | "gemini";
  models: Record<AiFeature, { model: LanguageModel; modelId: string }>;
  /** Second models for streamed text when the first is overloaded (ADR-0016). */
  fallbacks?: Partial<Record<AiFeature, { model: LanguageModel; modelId: string }>>;
}

/**
 * Placeholder answers until each feature brings its own mock responder with its prompt
 * (triage: step 2, drafts: step 3). JSON requests get an empty object, which fails any real
 * schema loudly instead of passing by accident.
 */
const placeholder: MockResponder = (request) =>
  request.json ? "{}" : "This is a placeholder answer from the offline mock model.";

export function createMockModels(
  responders: Partial<Record<AiFeature, MockResponder>> = {},
  options: { chunkDelayMs?: number } = {},
): AiModels {
  const make = (feature: AiFeature) => ({
    model: createMockLanguageModel({ respond: responders[feature] ?? placeholder, ...options }),
    modelId: MOCK_MODEL_ID,
  });
  return {
    provider: "mock",
    models: { triage: make("triage"), draft: make("draft"), grade: make("grade") },
  };
}

export function createGeminiModels(options: { apiKey: string; fetch?: typeof globalThis.fetch }): AiModels {
  const google = createGoogle({ apiKey: options.apiKey, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const make = (modelId: string) => ({ model: google.languageModel(modelId), modelId });
  const fallbacks: AiModels["fallbacks"] = {};
  for (const feature of AI_FEATURES) {
    const id = FEATURE_SETTINGS[feature].fallbackModelId;
    if (id) fallbacks[feature] = make(id);
  }
  return {
    provider: "gemini",
    models: {
      triage: make(FEATURE_SETTINGS.triage.modelId),
      draft: make(FEATURE_SETTINGS.draft.modelId),
      grade: make(FEATURE_SETTINGS.grade.modelId),
    },
    fallbacks,
  };
}

/** Picks the provider from validated settings (getEnv / getWorkerEnv), like createEmbedderFromEnv. */
export function createModelsFromEnv(
  env: { AI_PROVIDER: "mock" | "gemini"; GEMINI_API_KEY?: string | undefined },
  mockResponders: Partial<Record<AiFeature, MockResponder>> = {},
): AiModels {
  if (env.AI_PROVIDER === "gemini") {
    // env validation already guarantees the key; this guards direct callers.
    if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required when AI_PROVIDER=gemini");
    return createGeminiModels({ apiKey: env.GEMINI_API_KEY });
  }
  return createMockModels(mockResponders, { chunkDelayMs: 15 });
}
