/**
 * Guards against an API key that can't be sent in an HTTP header (e.g. a phone paste that added
 * control characters). fetch refuses such a header before any request is made, and the AI SDK
 * reports that as a retryable network error, so a damaged key was retried as if Google were
 * down, and every retry counted against the daily caps. With this guard the call fails at once
 * with UnsendableApiKeyError, which the classifiers treat as a permanent rejection.
 */
export class UnsendableApiKeyError extends Error {
  constructor() {
    super("The AI provider API key contains characters that can't be sent in an HTTP header.");
    this.name = "UnsendableApiKeyError";
  }
}

/** Visible ASCII only: what Gemini keys use, and always valid in a header value. */
export function isSendableApiKey(apiKey: string): boolean {
  return /^[\x21-\x7e]+$/.test(apiKey);
}

/**
 * The fetch to give the provider. With a sendable key it is the caller's fetch (undefined means
 * the provider's default); otherwise a fetch that fails before any network call.
 */
export function apiKeyGuardedFetch(apiKey: string, fetch?: typeof globalThis.fetch) {
  if (isSendableApiKey(apiKey)) return fetch;
  return (async () => {
    throw new UnsendableApiKeyError();
  }) as typeof globalThis.fetch;
}
