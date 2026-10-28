import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { apiKeyGuardedFetch, isSendableApiKey, UnsendableApiKeyError } from "@/server/modules/ai/api-key";
import { MOCK_MODEL_ID } from "@/server/modules/ai/config";
import { classifyAiError } from "@/server/modules/ai/errors";
import { createAiGateway, type AiGatewayOptions, type AiLedger } from "@/server/modules/ai/gateway";
import { createGeminiModels, type AiModels } from "@/server/modules/ai/models";
import type { AiUsageRecord } from "@/server/modules/ai/repository";
import {
  classifyEmbeddingError,
  createGeminiEmbedder,
  createMockEmbedder,
  withDailyEmbeddingCap,
  type Embedder,
} from "@/server/modules/kb/embedder";
import { IngestError } from "@/server/modules/kb/ingest-errors";

/**
 * A damaged API key (a phone paste added control characters) used to be retried as a network
 * outage, and every retry counted against the daily caps; on the live demo it used up the day's
 * embedding allowance (2026-10-28). Now the call fails at once as a rejection, and rejected
 * calls give their reservation back.
 */

const DAMAGED = "AQ.test\u0016key";
const GOOD = "AQ.Test-key_0123456789";

const spyFetch = () => {
  const state = { calls: 0 };
  const fetchFn = (async () => {
    state.calls += 1;
    throw new Error("must not be called");
  }) as unknown as typeof fetch;
  return { state, fetchFn };
};

describe("API key guard", () => {
  it("accepts visible ASCII keys and refuses control characters, spaces and non-ASCII", () => {
    expect(isSendableApiKey(GOOD)).toBe(true);
    for (const bad of [DAMAGED, "AQ.key\n", "AQ key", "AQ.kéy", "\u200bAQ.key", ""]) {
      expect(isSendableApiKey(bad)).toBe(false);
    }
  });

  it("keeps the caller's fetch (or the default) for a good key and refuses before fetch for a damaged one", async () => {
    const { fetchFn } = spyFetch();
    expect(apiKeyGuardedFetch(GOOD)).toBeUndefined();
    expect(apiKeyGuardedFetch(GOOD, fetchFn)).toBe(fetchFn);
    await expect(apiKeyGuardedFetch(DAMAGED, fetchFn)!("https://example.test")).rejects.toBeInstanceOf(
      UnsendableApiKeyError,
    );
  });

  it("both classifiers treat it as a permanent rejection, also inside a retry wrapper", () => {
    const err = new UnsendableApiKeyError();
    expect(classifyAiError(err, { clientAborted: false })).toMatchObject({
      code: "ai_rejected",
      temporary: false,
    });
    expect(classifyEmbeddingError(err)).toMatchObject({ code: "embedding_rejected", permanent: true });
  });
});

describe("Gemini embedder with a damaged key", () => {
  it("fails at once as a permanent rejection without any network call or retry", async () => {
    const { state, fetchFn } = spyFetch();
    const embedder = createGeminiEmbedder({ apiKey: DAMAGED, fetch: fetchFn, maxRetries: 2 });
    await expect(embedder.embedQuery("refunds")).rejects.toMatchObject({
      code: "embedding_rejected",
      permanent: true,
    });
    expect(state.calls).toBe(0);
  });
});

describe("daily embedding cap gives back rejected calls", () => {
  const failing = (error: Error): Embedder => ({
    ...createMockEmbedder(),
    embedDocuments: async () => {
      throw error;
    },
    embedQuery: async () => {
      throw error;
    },
  });
  const ledger = (opts: { failRelease?: boolean } = {}) => {
    const log: string[] = [];
    return {
      log,
      reserve: async (n: number) => {
        log.push(`reserve ${n}`);
        return true;
      },
      release: async (n: number) => {
        log.push(`release ${n}`);
        if (opts.failRelease) throw new Error("db down");
      },
    };
  };
  const docs = [
    { title: "a", text: "one" },
    { title: "b", text: "two" },
    { title: "c", text: "three" },
  ];

  it("a rejected call returns all its units", async () => {
    const cap = ledger();
    const capped = withDailyEmbeddingCap(
      failing(new IngestError("embedding_rejected")),
      cap.reserve,
      cap.release,
    );
    await expect(capped.embedDocuments(docs)).rejects.toMatchObject({ code: "embedding_rejected" });
    await expect(capped.embedQuery("x")).rejects.toMatchObject({ code: "embedding_rejected" });
    expect(cap.log).toEqual(["reserve 3", "release 3", "reserve 1", "release 1"]);
  });

  it("the real damaged-key path returns its units", async () => {
    const cap = ledger();
    const { fetchFn } = spyFetch();
    const capped = withDailyEmbeddingCap(
      createGeminiEmbedder({ apiKey: DAMAGED, fetch: fetchFn }),
      cap.reserve,
      cap.release,
    );
    await expect(capped.embedQuery("x")).rejects.toMatchObject({ code: "embedding_rejected" });
    expect(cap.log).toEqual(["reserve 1", "release 1"]);
  });

  it("outages, invalid answers and successes stay counted, so the cap still bounds retries", async () => {
    const cap = ledger();
    for (const code of ["embedding_unavailable", "embedding_invalid"] as const) {
      const capped = withDailyEmbeddingCap(failing(new IngestError(code)), cap.reserve, cap.release);
      await expect(capped.embedQuery("x")).rejects.toMatchObject({ code });
    }
    await withDailyEmbeddingCap(createMockEmbedder(), cap.reserve, cap.release).embedQuery("x");
    expect(cap.log).toEqual(["reserve 1", "reserve 1", "reserve 1"]);
  });

  it("a failed give-back doesn't hide the provider's error", async () => {
    const cap = ledger({ failRelease: true });
    const capped = withDailyEmbeddingCap(
      failing(new IngestError("embedding_rejected")),
      cap.reserve,
      cap.release,
    );
    await expect(capped.embedQuery("x")).rejects.toMatchObject({ code: "embedding_rejected" });
  });
});

describe("AI gateway gives back rejected calls", () => {
  const schema = z.object({ category: z.string() });
  const request = { feature: "triage" as const, system: "s", prompt: "p", schema };
  const apiError = (statusCode: number) =>
    new APICallError({
      message: "provider error",
      url: "https://example.test",
      requestBodyValues: {},
      statusCode,
      isRetryable: statusCode === 429 || statusCode >= 500,
    });
  const failingModels = (error: unknown): AiModels => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw error;
      },
    });
    const slot = { model, modelId: MOCK_MODEL_ID };
    return { provider: "mock", models: { triage: slot, draft: slot, grade: slot } };
  };
  const setup = (models: AiModels) => {
    const state = { reserved: 0, released: 0 };
    const records: AiUsageRecord[] = [];
    const ledger: AiLedger = {
      getPolicy: async () => ({ aiEnabled: true, monthlyTokenBudget: 1_000_000, tokensUsedThisMonth: 0 }),
      reserveDailyCall: async () => {
        state.reserved += 1;
        return true;
      },
      releaseDailyCall: async () => {
        state.released += 1;
      },
      recordUsage: async (_workspaceId, row) => void records.push(row),
    };
    const warnings: Array<Record<string, unknown>> = [];
    const gateway = createAiGateway({
      models,
      ledger,
      dailyCallLimit: 100,
      logger: {
        warn: (obj: Record<string, unknown>) => void warnings.push(obj),
      } as unknown as AiGatewayOptions["logger"],
    });
    return { gateway, state, records, warnings };
  };
  const ctx = { workspaceId: "ws-1" };

  it("a damaged key: no network call, a permanent rejection, the call given back, the cause logged", async () => {
    const { state: net, fetchFn } = spyFetch();
    const { gateway, state, records, warnings } = setup(
      createGeminiModels({ apiKey: DAMAGED, fetch: fetchFn }),
    );
    await expect(gateway.generateObject(ctx, request)).rejects.toMatchObject({ code: "ai_rejected" });
    expect(net.calls).toBe(0);
    expect(state).toEqual({ reserved: 1, released: 1 });
    expect(records[0]).toMatchObject({ outcome: "error" });
    expect(warnings[0]).toMatchObject({ code: "ai_rejected", causeName: "UnsendableApiKeyError" });
  });

  it("a 401 from the provider is given back too", async () => {
    const { gateway, state } = setup(failingModels(apiError(401)));
    await expect(gateway.generateObject(ctx, request)).rejects.toMatchObject({ code: "ai_rejected" });
    expect(state).toEqual({ reserved: 1, released: 1 });
  });

  it("overloads and rate limits stay counted", async () => {
    for (const status of [503, 429]) {
      const { gateway, state } = setup(failingModels(apiError(status)));
      await expect(gateway.generateObject(ctx, request)).rejects.toMatchObject({ code: "ai_unavailable" });
      expect(state).toEqual({ reserved: 1, released: 0 });
    }
  });
});
