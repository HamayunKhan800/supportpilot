import { createGoogle } from "@ai-sdk/google";
import { APICallError, embedMany, InvalidResponseDataError, RetryError, TypeValidationError } from "ai";

import { EMBEDDING_DIMENSIONS } from "@/server/platform/db/schema";

import { IngestError } from "./ingest-errors";

/**
 * Text embeddings for knowledge-base retrieval (plan M4 D1–D3).
 *
 * Two implementations behind one interface:
 *  - Gemini `gemini-embedding-2` at 768 dimensions, with the document/query prefixes
 *    Google documents for retrieval (this model has no task_type parameter).
 *  - A deterministic offline mock (feature hashing) for development, CI and tests. It
 *    needs no key and no network, and it matches on shared words, not meaning.
 *
 * Every vector is validated (count, dimensions, finite values) and L2-normalized, so
 * cosine distance in pgvector behaves the same for both.
 */

export interface DocumentToEmbed {
  /** Shown to the model as the chunk's title: document title plus heading trail. */
  title: string;
  text: string;
}

export interface Embedder {
  /** Stored on each document; mixing models in one workspace is refused (D4). */
  readonly modelId: string;
  embedDocuments(items: DocumentToEmbed[], signal?: AbortSignal): Promise<EmbeddingBatch>;
  embedQuery(query: string, signal?: AbortSignal): Promise<{ embedding: number[]; tokenEstimate: number }>;
}

export interface EmbeddingBatch {
  embeddings: number[][];
  /** Gemini reports no usage for embeddings, so tokens are estimated (about 4 chars/token). */
  tokenEstimate: number;
}

// --- Shared helpers --------------------------------------------------------------------

/** One-line, separator-free title, so it cannot break Google's "title: … | text: …" format. */
function cleanTitle(title: string): string {
  const t = title.replace(/[|\s]+/g, " ").trim();
  return t === "" ? "none" : t;
}

export function formatDocumentForEmbedding(item: DocumentToEmbed): string {
  return `title: ${cleanTitle(item.title)} | text: ${item.text}`;
}

export function formatQueryForEmbedding(query: string): string {
  return `task: search result | query: ${query}`;
}

function estimateTokens(texts: string[]): number {
  return texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
}

/** Validates and L2-normalizes vectors. A provider returning garbage is a permanent failure. */
export function validateEmbeddings(
  vectors: number[][],
  expectedCount: number,
  dimensions: number,
): number[][] {
  if (vectors.length !== expectedCount) throw new IngestError("embedding_invalid");
  return vectors.map((v) => {
    if (v.length !== dimensions || !v.every(Number.isFinite)) throw new IngestError("embedding_invalid");
    const norm = Math.hypot(...v);
    if (norm === 0) throw new IngestError("embedding_invalid");
    return v.map((x) => x / norm);
  });
}

// --- Mock --------------------------------------------------------------------------------

const STOPWORDS = new Set(
  "a an and are as at be by can do does for from has have how i if in into is it its my no not of on or our so that the their them then there these this to was we what when where which who why will with you your".split(
    " ",
  ),
);

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Lowercase word tokens without stopwords, with plural/verb suffixes trimmed. */
export function mockTokens(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

/** Strips the first suffix whose removal leaves at least three letters ("uses" → "use", "bus" stays). */
function stem(word: string): string {
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) return word.slice(0, -suffix.length);
  }
  return word;
}

function hashEmbedding(text: string, dimensions: number): number[] {
  const counts = new Map<string, number>();
  for (const t of mockTokens(text)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const v = new Array<number>(dimensions).fill(0);
  for (const [token, tf] of counts) {
    const h = fnv1a(token);
    v[h % dimensions]! += (h & 0x80000000 ? -1 : 1) * (1 + Math.log(tf));
  }
  // No usable words: a fixed unit vector instead of a zero vector (cosine of zero is NaN).
  if (!v.some((x) => x !== 0)) v[0] = 1;
  return v;
}

export function createMockEmbedder(dimensions = EMBEDDING_DIMENSIONS): Embedder {
  return {
    modelId: `mock-hash@${dimensions}`,
    async embedDocuments(items) {
      const texts = items.map((i) => `${i.title}\n${i.text}`);
      return {
        embeddings: validateEmbeddings(
          texts.map((t) => hashEmbedding(t, dimensions)),
          items.length,
          dimensions,
        ),
        tokenEstimate: estimateTokens(texts),
      };
    },
    async embedQuery(query) {
      const [embedding] = validateEmbeddings([hashEmbedding(query, dimensions)], 1, dimensions);
      return { embedding: embedding!, tokenEstimate: estimateTokens([query]) };
    },
  };
}

// --- Gemini ------------------------------------------------------------------------------

export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
/** Paid-tier price (USD per 1M input tokens, ai.google.dev pricing, checked 2026-10-21). */
export const GEMINI_EMBEDDING_USD_PER_MILLION_TOKENS = 0.2;

export interface GeminiEmbedderOptions {
  apiKey: string;
  dimensions?: number;
  /** Per-request timeout in ms (default 60 s). */
  timeoutMs?: number;
  /** SDK-level retries for 429/5xx before the job-level retry takes over (default 2). */
  maxRetries?: number;
  /** For tests: a fake fetch. */
  fetch?: typeof fetch;
}

/** Maps SDK/network failures to temporary (retry later) or permanent (configuration) errors. */
export function classifyEmbeddingError(err: unknown): IngestError {
  if (err instanceof IngestError) return err;
  const last = RetryError.isInstance(err) ? err.lastError : err;
  // The API answered, but not with what was asked for (wrong count, malformed body).
  if (InvalidResponseDataError.isInstance(last) || TypeValidationError.isInstance(last)) {
    return new IngestError("embedding_invalid", { cause: last });
  }
  if (APICallError.isInstance(last)) {
    const status = last.statusCode ?? 0;
    // A success status with a body that fails the SDK's response schema.
    if (status >= 200 && status < 300) return new IngestError("embedding_invalid", { cause: last });
    const temporary = status === 408 || status === 429 || status >= 500 || (status === 0 && last.isRetryable);
    return new IngestError(temporary ? "embedding_unavailable" : "embedding_rejected", { cause: last });
  }
  // Timeouts, aborts and network failures (fetch throws TypeError) are temporary.
  return new IngestError("embedding_unavailable", { cause: last });
}

export function createGeminiEmbedder(options: GeminiEmbedderOptions): Embedder {
  const dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
  const google = createGoogle({ apiKey: options.apiKey, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const model = google.embedding(GEMINI_EMBEDDING_MODEL);

  async function embed(values: string[], signal?: AbortSignal): Promise<number[][]> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 60_000);
    try {
      const result = await embedMany({
        model,
        values,
        maxParallelCalls: 1, // free-tier friendly; batches of up to 100 per call
        maxRetries: options.maxRetries ?? 2,
        abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        providerOptions: { google: { outputDimensionality: dimensions } },
      });
      return validateEmbeddings(result.embeddings, values.length, dimensions);
    } catch (err) {
      throw classifyEmbeddingError(err);
    }
  }

  return {
    modelId: `${GEMINI_EMBEDDING_MODEL}@${dimensions}`,
    async embedDocuments(items, signal) {
      const values = items.map(formatDocumentForEmbedding);
      return { embeddings: await embed(values, signal), tokenEstimate: estimateTokens(values) };
    },
    async embedQuery(query, signal) {
      const value = formatQueryForEmbedding(query);
      const [embedding] = await embed([value], signal);
      return { embedding: embedding!, tokenEstimate: estimateTokens([value]) };
    },
  };
}

/** Estimated cost in micro-dollars (integer, as stored in ai_usage). */
export function embeddingCostMicros(modelId: string, tokens: number): number {
  return modelId.startsWith(GEMINI_EMBEDDING_MODEL)
    ? Math.round(tokens * GEMINI_EMBEDDING_USD_PER_MILLION_TOKENS)
    : 0;
}

/** Chooses the embedder from validated settings (AI_PROVIDER, GEMINI_API_KEY). */
export function createEmbedderFromEnv(env: {
  AI_PROVIDER: "mock" | "gemini";
  GEMINI_API_KEY?: string;
}): Embedder {
  if (env.AI_PROVIDER === "mock") return createMockEmbedder();
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required when AI_PROVIDER=gemini");
  return createGeminiEmbedder({ apiKey: env.GEMINI_API_KEY });
}
