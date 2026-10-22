import { describe, expect, it } from "vitest";

import { createEmbedderFromEnv } from "@/server/modules/kb/embedder";
import {
  KB_INGEST_DEAD_LETTER_QUEUE,
  KB_INGEST_QUEUE,
  kbIngestPayloadSchema,
  QUEUE_INSTALL_ORDER,
  QUEUE_SETTINGS,
} from "@/server/platform/jobs/queues";

describe("kb.ingest payload", () => {
  const valid = { workspaceId: "Xk3opaqueBetterAuthId", documentId: "0b6a3f1e-8f0e-4c55-9a43-5f0f6f1d2c11" };

  it("accepts a workspace id and a document uuid", () => {
    expect(kbIngestPayloadSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    ["a non-uuid document id", { ...valid, documentId: "1" }],
    ["an empty workspace id", { ...valid, workspaceId: "" }],
    ["an overlong workspace id", { ...valid, workspaceId: "w".repeat(65) }],
    ["extra fields", { ...valid, sql: "drop table" }],
    ["a missing field", { workspaceId: valid.workspaceId }],
  ])("rejects %s", (_name, value) => {
    expect(kbIngestPayloadSchema.safeParse(value).success).toBe(false);
  });
});

describe("queue settings", () => {
  const ingest = QUEUE_SETTINGS[KB_INGEST_QUEUE]!;

  it("sends exhausted ingest jobs to a dead-letter queue that is installed first", () => {
    expect(ingest.deadLetter).toBe(KB_INGEST_DEAD_LETTER_QUEUE);
    expect(QUEUE_INSTALL_ORDER.indexOf(KB_INGEST_DEAD_LETTER_QUEUE)).toBeLessThan(
      QUEUE_INSTALL_ORDER.indexOf(KB_INGEST_QUEUE),
    );
    expect(Object.keys(QUEUE_SETTINGS).sort()).toEqual([...QUEUE_INSTALL_ORDER].sort());
  });

  it("gives one attempt enough time for the PDF timeout plus several embedding calls", () => {
    expect(ingest.expireInSeconds).toBeGreaterThanOrEqual(30 + 3 * 60);
    expect(ingest.heartbeatSeconds).toBeGreaterThanOrEqual(10); // pg-boss minimum
    expect(ingest.heartbeatSeconds!).toBeLessThan(ingest.expireInSeconds);
  });

  it("retries temporary failures with backoff for longer than a one-minute quota window", () => {
    expect(ingest.retryBackoff).toBe(true);
    // Shortest possible total wait: retryDelay × (1 + 2 + 4 …) / 2 with zero jitter.
    const minimumWait = Array.from(
      { length: ingest.retryLimit },
      (_, i) => ingest.retryDelay * 2 ** i,
    ).reduce((a, b) => a + b, 0);
    expect(minimumWait).toBeGreaterThan(60);
  });
});

describe("createEmbedderFromEnv", () => {
  it("chooses the mock or Gemini embedder from settings", () => {
    expect(createEmbedderFromEnv({ AI_PROVIDER: "mock" }).modelId).toBe("mock-hash@768");
    expect(createEmbedderFromEnv({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "k" }).modelId).toBe(
      "gemini-embedding-2@768",
    );
    expect(() => createEmbedderFromEnv({ AI_PROVIDER: "gemini" })).toThrow(/GEMINI_API_KEY/);
  });
});
