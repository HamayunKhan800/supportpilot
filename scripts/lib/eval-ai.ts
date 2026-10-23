import path from "node:path";

import { FEATURE_SETTINGS, MOCK_MODEL_ID } from "../../src/server/modules/ai/config";
import { createAiGateway, createPostgresLedger, type AiLedger } from "../../src/server/modules/ai/gateway";
import { createGeminiModels, createMockModels } from "../../src/server/modules/ai/models";
import { mockDraftResponder } from "../../src/server/modules/drafts/mock-responder";
import { mockGraderResponder } from "../../src/server/modules/eval/grader-mock-responder";
import {
  createGeminiEmbedder,
  createMockEmbedder,
  type Embedder,
} from "../../src/server/modules/kb/embedder";
import { mockTriageResponder } from "../../src/server/modules/triage/mock-responder";
import { getDb } from "../../src/server/platform/db/client";

import { meterGateway, type MeteredGateway } from "./ai-smoke";
import { createTextRateLimiter } from "./rate-limit";
import { fileEmbeddingCache, instrument } from "./retrieval-eval";

/**
 * The model connection for the evaluation scripts (eval:ai and eval): the mock, or Gemini
 * with the free-tier safeguards. Every generation call is spaced out (gapMs), the number of
 * provider requests is capped where the app counts them (the daily-cap step, so a draft that
 * falls back to the second model counts twice), and the run stops at the first 429. The cap
 * is the run's own: the deployment's shared daily counter is left untouched.
 */
export interface EvalModels {
  triage: string;
  draft: string;
  draftFallback: string | null;
  /** The groundedness grader (evaluation only). */
  grade: string;
}

export interface EvalAi {
  metered: MeteredGateway;
  embedder: Embedder;
  /** Model ids as configured (what the run is tagged with). */
  models: EvalModels;
  /** Provider requests sent so far in this session, fallbacks included. */
  requestsSent(): number;
  /** Removes the API key from text that will be printed or stored. */
  redact(text: string): string;
}

export function createEvalAi(options: {
  provider: "mock" | "gemini";
  maxCalls: number;
  gapMs: number;
  cacheDir: string;
  apiKey?: string | undefined;
}): EvalAi {
  const { db } = getDb();
  let embedder: Embedder;
  let gatewayModels;
  let redact = (s: string) => s;
  let models: EvalAi["models"];
  if (options.provider === "gemini") {
    const apiKey = options.apiKey;
    if (!apiKey) throw new Error("Set GEMINI_API_KEY for --provider gemini");
    redact = (s) => s.replaceAll(apiKey, "[REDACTED]");
    gatewayModels = createGeminiModels({ apiKey });
    // Same limits as the retrieval eval: half the free tier's 100 texts and 30,000 tokens per minute.
    embedder = instrument(
      createGeminiEmbedder({ apiKey, maxRetries: 0 }),
      0,
      fileEmbeddingCache(path.resolve(options.cacheDir)),
      createTextRateLimiter({ maxPerMinute: 50, maxTokensPerMinute: 15_000, maxBatch: 10, even: true }),
    ).embedder;
    models = {
      triage: FEATURE_SETTINGS.triage.modelId,
      draft: FEATURE_SETTINGS.draft.modelId,
      draftFallback: FEATURE_SETTINGS.draft.fallbackModelId ?? null,
      grade: FEATURE_SETTINGS.grade.modelId,
    };
  } else {
    gatewayModels = createMockModels({
      draft: mockDraftResponder,
      triage: mockTriageResponder,
      grade: mockGraderResponder,
    });
    embedder = createMockEmbedder();
    models = { triage: MOCK_MODEL_ID, draft: MOCK_MODEL_ID, draftFallback: null, grade: MOCK_MODEL_ID };
  }
  const ledger = createPostgresLedger(db);
  const requests = { sent: 0 };
  // The run's own cap replaces the deployment's daily call counter instead of adding to it: an
  // evaluation must not use up the app's daily AI allowance (finding #108). Token usage is
  // still recorded, against the run's temporary workspace, which is deleted afterwards.
  const cappedLedger: AiLedger = {
    ...ledger,
    reserveDailyCall: async () => {
      if (requests.sent >= options.maxCalls) return false;
      requests.sent++;
      return true;
    },
  };
  const metered = meterGateway(
    createAiGateway({ models: gatewayModels, ledger: cappedLedger, dailyCallLimit: 100_000 }),
    { gapMs: options.gapMs, maxCalls: options.maxCalls, redact },
  );
  return { metered, embedder, models, requestsSent: () => requests.sent, redact };
}
