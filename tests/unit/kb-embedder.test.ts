import { describe, expect, it } from "vitest";

import {
  createGeminiEmbedder,
  createMockEmbedder,
  embeddingCostMicros,
  formatDocumentForEmbedding,
  formatQueryForEmbedding,
  mockTokens,
  validateEmbeddings,
} from "@/server/modules/kb/embedder";
import { IngestError } from "@/server/modules/kb/ingest-errors";

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
const norm = (v: number[]) => Math.hypot(...v);

describe("Google retrieval prefixes", () => {
  it("formats documents and queries exactly as documented for gemini-embedding-2", () => {
    expect(formatDocumentForEmbedding({ title: "Billing › Refunds", text: "Refunds take 5 days." })).toBe(
      "title: Billing › Refunds | text: Refunds take 5 days.",
    );
    expect(formatQueryForEmbedding("how long do refunds take?")).toBe(
      "task: search result | query: how long do refunds take?",
    );
  });

  it("uses 'none' for an empty title and keeps the title on one line without separators", () => {
    expect(formatDocumentForEmbedding({ title: "  ", text: "x" })).toBe("title: none | text: x");
    expect(formatDocumentForEmbedding({ title: "a | b\nc", text: "x" })).toBe("title: a b c | text: x");
  });
});

describe("validateEmbeddings", () => {
  it("L2-normalizes valid vectors", () => {
    const [v] = validateEmbeddings([[3, 4]], 1, 2);
    expect(v).toEqual([0.6, 0.8]);
  });

  it.each([
    ["wrong count", [[1, 0]], 2, 2],
    ["wrong dimensions", [[1, 0, 0]], 1, 2],
    ["non-finite value", [[1, Number.NaN]], 1, 2],
    ["null value", [[1, null as unknown as number]], 1, 2],
    ["zero vector", [[0, 0]], 1, 2],
  ])("rejects %s", (_name, vectors, count, dims) => {
    expect(() => validateEmbeddings(vectors, count, dims)).toThrow(
      expect.objectContaining({ code: "embedding_invalid" }),
    );
  });
});

describe("mock embedder", () => {
  const mock = createMockEmbedder();

  it("is deterministic, unit-length and 768-dimensional", async () => {
    const a = await mock.embedQuery("refund policy");
    const b = await mock.embedQuery("refund policy");
    expect(mock.modelId).toBe("mock-hash@768");
    expect(a.embedding).toHaveLength(768);
    expect(a.embedding).toEqual(b.embedding);
    expect(norm(a.embedding)).toBeCloseTo(1, 10);
  });

  it("ranks a document sharing words above an unrelated one", async () => {
    const { embeddings } = await mock.embedDocuments([
      { title: "Billing › Refunds", text: "Refunds are issued within 5 business days." },
      { title: "Shipping", text: "Parcels ship from Lahore by courier." },
    ]);
    const { embedding: q } = await mock.embedQuery("When will my refund be issued?");
    expect(cosine(q, embeddings[0]!)).toBeGreaterThan(cosine(q, embeddings[1]!));
    expect(cosine(q, embeddings[0]!)).toBeGreaterThan(0.2);
  });

  it("returns a fixed unit vector for text with no usable words", async () => {
    const { embedding } = await mock.embedQuery("?? the a");
    expect(embedding[0]).toBe(1);
    expect(norm(embedding)).toBe(1);
  });

  it("tokenizes with accent folding, stopwords and light stemming", () => {
    expect(mockTokens("The Refunds were REFUNDED, café billing is ok")).toEqual([
      "refund",
      "were",
      "refund",
      "cafe",
      "bill",
      "ok",
    ]);
    expect(mockTokens("bus uses billing")).toEqual(["bus", "use", "bill"]);
  });

  it("estimates tokens and costs nothing", async () => {
    const { tokenEstimate } = await mock.embedDocuments([{ title: "T", text: "abcdefg" }]);
    expect(tokenEstimate).toBe(3); // "T\nabcdefg" = 9 chars
    expect(embeddingCostMicros(mock.modelId, 1_000_000)).toBe(0);
  });
});

// --- Gemini adapter against a fake fetch -----------------------------------------------

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function fakeFetch(respond: (req: Captured, call: number) => Response | Promise<Response>) {
  const calls: Captured[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    };
    calls.push(req);
    return respond(req, calls.length);
  }) as typeof fetch;
  return { fetchFn, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const vec = (dims = 768, value = 2) => Array.from({ length: dims }, () => value);

/** Answers like the real API: one vector per request in a batch, or a single embedding. */
function okResponder(dims = 768) {
  return (req: Captured) => {
    const requests = req.body.requests as unknown[] | undefined;
    return requests
      ? json(200, { embeddings: requests.map(() => ({ values: vec(dims) })) })
      : json(200, { embedding: { values: vec(dims) } });
  };
}

const KEY = "test-key-not-real";

describe("Gemini embedder", () => {
  it("sends batched, prefixed documents to gemini-embedding-2 at 768 dimensions", async () => {
    const { fetchFn, calls } = fakeFetch(okResponder());
    const embedder = createGeminiEmbedder({ apiKey: KEY, fetch: fetchFn });
    const result = await embedder.embedDocuments([
      { title: "Guide › Setup", text: "Install it." },
      { title: "", text: "No title." },
    ]);

    expect(embedder.modelId).toBe("gemini-embedding-2@768");
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents",
    );
    expect(call!.url).not.toContain(KEY); // the key travels in a header, never in the URL
    expect(call!.headers.get("x-goog-api-key")).toBe(KEY);
    const requests = call!.body.requests as Array<{
      content: { parts: Array<{ text: string }> };
      outputDimensionality: number;
    }>;
    expect(requests.map((r) => r.content.parts[0]!.text)).toEqual([
      "title: Guide › Setup | text: Install it.",
      "title: none | text: No title.",
    ]);
    expect(requests.every((r) => r.outputDimensionality === 768)).toBe(true);

    expect(result.embeddings).toHaveLength(2);
    expect(norm(result.embeddings[0]!)).toBeCloseTo(1, 10);
    expect(result.tokenEstimate).toBeGreaterThan(0);
  });

  it("splits more than 100 documents into several calls, one at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { fetchFn, calls } = fakeFetch(async (req) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return okResponder()(req);
    });
    const embedder = createGeminiEmbedder({ apiKey: KEY, fetch: fetchFn });
    const items = Array.from({ length: 205 }, (_, i) => ({ title: "T", text: `chunk ${i}` }));
    const { embeddings } = await embedder.embedDocuments(items);
    expect(embeddings).toHaveLength(205);
    expect(calls.map((c) => (c.body.requests as unknown[]).length)).toEqual([100, 100, 5]);
    expect(maxInFlight).toBe(1);
  });

  it("embeds a query with the search prefix", async () => {
    const { fetchFn, calls } = fakeFetch(okResponder());
    const embedder = createGeminiEmbedder({ apiKey: KEY, fetch: fetchFn });
    const { embedding } = await embedder.embedQuery("reset password");
    expect(embedding).toHaveLength(768);
    expect(JSON.stringify(calls[0]!.body)).toContain("task: search result | query: reset password");
  });

  it("supports another configured dimension (1536 fallback in plan D1)", async () => {
    const { fetchFn } = fakeFetch(okResponder(1536));
    const embedder = createGeminiEmbedder({ apiKey: KEY, fetch: fetchFn, dimensions: 1536 });
    expect(embedder.modelId).toBe("gemini-embedding-2@1536");
    expect((await embedder.embedQuery("x")).embedding).toHaveLength(1536);
  });

  it("retries a temporary 503 and then succeeds", async () => {
    const { fetchFn, calls } = fakeFetch((req, n) =>
      n === 1 ? json(503, { error: { message: "busy" } }, { "retry-after-ms": "1" }) : okResponder()(req),
    );
    const embedder = createGeminiEmbedder({ apiKey: KEY, fetch: fetchFn, maxRetries: 1 });
    await expect(embedder.embedQuery("x")).resolves.toBeDefined();
    expect(calls).toHaveLength(2);
  });

  it.each([
    [429, "embedding_unavailable", false],
    [500, "embedding_unavailable", false],
    [503, "embedding_unavailable", false],
    [408, "embedding_unavailable", false],
    [400, "embedding_rejected", true],
    [401, "embedding_rejected", true],
    [403, "embedding_rejected", true],
    [404, "embedding_rejected", true],
  ])("maps HTTP %i to %s (permanent: %s)", async (status, code, permanent) => {
    const { fetchFn } = fakeFetch(() => json(status, { error: { code: status, message: "nope" } }));
    const embedder = createGeminiEmbedder({ apiKey: KEY, fetch: fetchFn, maxRetries: 0 });
    const err = await embedder.embedQuery("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect(err).toMatchObject({ code, permanent });
  });

  it("maps exhausted retries on 429 to a temporary error", async () => {
    const busy = fakeFetch(() => json(429, { error: { message: "quota" } }, { "retry-after-ms": "1" }));
    await expect(
      createGeminiEmbedder({ apiKey: KEY, fetch: busy.fetchFn, maxRetries: 1 }).embedQuery("x"),
    ).rejects.toMatchObject({
      code: "embedding_unavailable",
    });
    expect(busy.calls).toHaveLength(2);
  });

  it("maps network failures to a temporary error", async () => {
    const down = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(
      createGeminiEmbedder({ apiKey: KEY, fetch: down.fetchFn, maxRetries: 0 }).embedQuery("x"),
    ).rejects.toMatchObject({
      code: "embedding_unavailable",
    });
  });

  it("gives up after the timeout with a temporary error", async () => {
    const slow = createGeminiEmbedder({ apiKey: KEY, fetch: hangingFetch, maxRetries: 0, timeoutMs: 50 });
    await expect(slow.embedQuery("x")).rejects.toMatchObject({ code: "embedding_unavailable" });
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    const pending = createGeminiEmbedder({ apiKey: KEY, fetch: hangingFetch, maxRetries: 0 }).embedQuery(
      "x",
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "embedding_unavailable" });
  });

  it("rejects wrong dimensions or a missing vector from the API as permanent", async () => {
    const wrongDims = fakeFetch(() => json(200, { embedding: { values: vec(3) } }));
    await expect(
      createGeminiEmbedder({ apiKey: KEY, fetch: wrongDims.fetchFn }).embedQuery("x"),
    ).rejects.toMatchObject({
      code: "embedding_invalid",
      permanent: true,
    });
    // The SDK itself notices the missing vector (InvalidResponseDataError).
    const short = fakeFetch(() => json(200, { embeddings: [{ values: vec() }] }));
    await expect(
      createGeminiEmbedder({ apiKey: KEY, fetch: short.fetchFn }).embedDocuments([
        { title: "a", text: "a" },
        { title: "b", text: "b" },
      ]),
    ).rejects.toMatchObject({ code: "embedding_invalid" });
    const malformed = fakeFetch(() => json(200, { unexpected: true }));
    await expect(
      createGeminiEmbedder({ apiKey: KEY, fetch: malformed.fetchFn }).embedQuery("x"),
    ).rejects.toMatchObject({
      code: "embedding_invalid",
    });
  });

  it("estimates cost at the paid-tier list price in micro-dollars", () => {
    expect(embeddingCostMicros("gemini-embedding-2@768", 1_000_000)).toBe(200_000); // $0.20
    expect(embeddingCostMicros("gemini-embedding-2@768", 1234)).toBe(247);
  });
});

/** A fetch that never answers but rejects when its signal aborts, like real fetch. */
const hangingFetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) reject(signal.reason);
    signal?.addEventListener("abort", () => reject(signal.reason));
  })) as typeof fetch;
