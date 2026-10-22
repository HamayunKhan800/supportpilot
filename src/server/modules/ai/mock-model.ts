import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { MOCK_MODEL_ID } from "./config";

/**
 * The offline `mock` provider (ADR-0006, M5 D3): a deterministic language model for CI, local
 * development and E2E, so the whole pipeline (prompting, structured output, streaming, usage
 * recording) runs without a key or network. It is built on the AI SDK's own
 * `MockLanguageModelV4`, so the SDK code paths are exactly those used with Gemini.
 *
 * Each feature supplies a responder that reads the prompt and returns the model's text; the
 * triage and draft responders arrive with their prompts (M5 steps 2 and 3).
 */

type CallOptions = Parameters<MockLanguageModelV4["doGenerate"]>[0];

export interface MockRequest {
  /** System instructions, joined. */
  system: string;
  /** User and assistant message text, joined in order. */
  prompt: string;
  /** JSON output was requested (structured output), with this JSON Schema if given. */
  json: boolean;
  schema: unknown;
}

export type MockResponder = (request: MockRequest) => string;

function toRequest(options: CallOptions): MockRequest {
  const system: string[] = [];
  const prompt: string[] = [];
  for (const message of options.prompt) {
    if (message.role === "system") {
      system.push(message.content);
      continue;
    }
    for (const part of message.content) {
      if (part.type === "text") prompt.push(part.text);
    }
  }
  const format = options.responseFormat;
  return {
    system: system.join("\n"),
    prompt: prompt.join("\n"),
    json: format?.type === "json",
    schema: format?.type === "json" ? format.schema : undefined,
  };
}

/** characters ÷ 4, the same estimate the knowledge base uses (M4 D8). */
const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

function usage(input: string, output: string) {
  const inputTokens = estimateTokens(input);
  const outputTokens = estimateTokens(output);
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: undefined },
  };
}

/** Splits text into chunks of a few words, keeping the whitespace, so streaming looks real. */
export function splitIntoChunks(text: string, wordsPerChunk = 3): string[] {
  const words = text.match(/\S+\s*/g) ?? [];
  const leading = /^\s+/.exec(text)?.[0] ?? "";
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(""));
  }
  if (leading && chunks.length > 0) chunks[0] = leading + chunks[0];
  return chunks.length > 0 ? chunks : text ? [text] : [];
}

export function createMockLanguageModel(options: {
  respond: MockResponder;
  /** Delay between streamed chunks; 0 in tests, a little more for a realistic local demo. */
  chunkDelayMs?: number;
  modelId?: string;
}) {
  const modelId = options.modelId ?? MOCK_MODEL_ID;
  return new MockLanguageModelV4({
    provider: "mock",
    modelId,
    doGenerate: async (callOptions) => {
      const request = toRequest(callOptions);
      const text = options.respond(request);
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "STOP" },
        usage: usage(request.system + request.prompt, text),
        warnings: [],
      };
    },
    doStream: async (callOptions) => {
      const request = toRequest(callOptions);
      const text = options.respond(request);
      return {
        stream: simulateReadableStream({
          initialDelayInMs: null,
          chunkDelayInMs: options.chunkDelayMs ?? 0,
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "t0" },
            ...splitIntoChunks(text).map((delta) => ({ type: "text-delta" as const, id: "t0", delta })),
            { type: "text-end" as const, id: "t0" },
            {
              type: "finish" as const,
              finishReason: { unified: "stop" as const, raw: "STOP" },
              usage: usage(request.system + request.prompt, text),
            },
          ],
        }),
      };
    },
  });
}
