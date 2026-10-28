import {
  APICallError,
  InvalidResponseDataError,
  JSONParseError,
  NoObjectGeneratedError,
  RetryError,
  TypeValidationError,
} from "ai";
import type { AiUsageOutcome } from "@/server/platform/db/schema";
import { UnsendableApiKeyError } from "./api-key";

/**
 * Why an AI call did not produce a result. Callers map these to plain-language messages;
 * the provider's own error text is never shown to users (it can echo request details).
 */
export const AI_ERROR_CODES = [
  /** AI is switched off for this workspace (admin setting). */
  "ai_disabled",
  /** The workspace used its monthly token budget (FR-AI7). */
  "ai_budget_exhausted",
  /** The deployment-wide daily call cap was reached (D12b). */
  "ai_daily_limit",
  /** Provider unreachable, overloaded or rate-limited (429/5xx/network), or circuit open. */
  "ai_unavailable",
  /** No answer in time: total timeout, first-chunk timeout or a stalled stream. */
  "ai_timeout",
  /** The model answered with unparseable or schema-invalid output. */
  "ai_invalid_output",
  /** The provider refused the request itself (bad key, unknown model, bad request). */
  "ai_rejected",
  /** The caller cancelled (e.g. the agent closed the page). */
  "ai_aborted",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export class AiError extends Error {
  readonly code: AiErrorCode;
  /** When a retry could succeed (e.g. Retry-After, circuit cooldown), in milliseconds. */
  readonly retryAfterMs: number | undefined;

  constructor(code: AiErrorCode, options: { cause?: unknown; retryAfterMs?: number } = {}) {
    super(code, { cause: options.cause });
    this.name = "AiError";
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
  }

  /** Worth retrying later without any change: the provider or network was the problem. */
  get temporary(): boolean {
    return this.code === "ai_unavailable" || this.code === "ai_timeout";
  }

  /** The value recorded in ai_usage.outcome. */
  get outcome(): AiUsageOutcome {
    switch (this.code) {
      case "ai_invalid_output":
        return "invalid";
      case "ai_timeout":
        return "timeout";
      case "ai_aborted":
        return "aborted";
      default:
        return "error";
    }
  }
}

/** Retry-After header in milliseconds (seconds or HTTP date), if the provider sent one. */
function retryAfterMs(err: APICallError): number | undefined {
  const value = err.responseHeaders?.["retry-after"];
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/**
 * Turns any error from an AI SDK call into an AiError. `clientAborted` says whether the caller's
 * own signal fired: the SDK reports a cancellation and a timeout the same way (an abort), so
 * only the caller can tell them apart. Same rules as the embedder (classifyEmbeddingError).
 */
export function classifyAiError(err: unknown, { clientAborted }: { clientAborted: boolean }): AiError {
  if (err instanceof AiError) return err;
  if (clientAborted) return new AiError("ai_aborted", { cause: err });
  const last = RetryError.isInstance(err) ? err.lastError : err;
  // A damaged key: nothing was sent, and retrying can't help.
  if (last instanceof UnsendableApiKeyError) return new AiError("ai_rejected", { cause: last });
  if (
    NoObjectGeneratedError.isInstance(last) ||
    JSONParseError.isInstance(last) ||
    TypeValidationError.isInstance(last) ||
    InvalidResponseDataError.isInstance(last)
  ) {
    return new AiError("ai_invalid_output", { cause: last });
  }
  if (APICallError.isInstance(last)) {
    const status = last.statusCode ?? 0;
    // A success status whose body fails the SDK's response schema.
    if (status >= 200 && status < 300) return new AiError("ai_invalid_output", { cause: last });
    const temporary = status === 408 || status === 429 || status >= 500 || (status === 0 && last.isRetryable);
    return temporary
      ? new AiError("ai_unavailable", { cause: last, retryAfterMs: retryAfterMs(last) })
      : new AiError("ai_rejected", { cause: last });
  }
  // AI SDK timeouts throw a DOMException named TimeoutError (probed against ai 7.0.142).
  if (last instanceof Error && last.name === "TimeoutError")
    return new AiError("ai_timeout", { cause: last });
  // Network failures (fetch throws TypeError) and anything unexpected: treat as temporary.
  return new AiError("ai_unavailable", { cause: last });
}
