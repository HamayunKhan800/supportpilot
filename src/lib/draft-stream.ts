import type { ApiDraft } from "@/server/modules/drafts/serialize";
import type { DraftEvent } from "@/server/modules/drafts/service";
import { problemMessage, type ApiProblem } from "./api-client";

/**
 * Browser side of POST /api/v1/tickets/{id}/drafts (M5 D6): reads the NDJSON stream with
 * `fetch`, which our CSP allows (`connect-src 'self'`), and reports each step.
 */

export type DraftStreamResult =
  | { kind: "done"; draft: ApiDraft }
  | { kind: "error"; code: string; message: string; retryable: boolean; draftId?: string }
  | { kind: "aborted" };

export interface DraftStreamHandlers {
  onStart?: (draftId: string) => void;
  onDelta?: (text: string) => void;
}

const INTERRUPTED = "The connection was interrupted before the draft was finished. Try again.";

const interrupted = (draftId: string | undefined): DraftStreamResult => ({
  kind: "error",
  code: "interrupted",
  message: INTERRUPTED,
  retryable: true,
  draftId,
});

export async function streamDraft(
  ticketId: string,
  handlers: DraftStreamHandlers,
  signal?: AbortSignal,
): Promise<DraftStreamResult> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/tickets/${ticketId}/drafts`, {
      method: "POST",
      headers: { accept: "application/x-ndjson" },
      credentials: "same-origin",
      signal,
    });
  } catch {
    if (signal?.aborted) return { kind: "aborted" };
    return {
      kind: "error",
      code: "offline",
      message: "You appear to be offline. Check your connection and try again.",
      retryable: true,
    };
  }
  if (!res.ok || !res.body) return httpFailure(res);

  let draftId: string | undefined;
  try {
    for await (const line of readLines(res.body)) {
      const event = JSON.parse(line) as DraftEvent;
      switch (event.type) {
        case "start":
          draftId = event.draftId;
          handlers.onStart?.(event.draftId);
          break;
        case "delta":
          handlers.onDelta?.(event.text);
          break;
        case "done":
          return { kind: "done", draft: event.draft };
        case "error":
          return {
            kind: "error",
            code: event.code,
            message: event.message,
            retryable: event.retryable,
            draftId: event.draftId,
          };
      }
    }
  } catch {
    // A dropped connection, a garbled line or the caller cancelling.
    if (signal?.aborted) return { kind: "aborted" };
  }
  // The stream ended without a final event.
  return interrupted(draftId);
}

/** The request was refused before any streaming started (problem+json, or no body at all). */
async function httpFailure(res: Response): Promise<DraftStreamResult> {
  const data: unknown = await res.json().catch(() => undefined);
  const problem: ApiProblem = { status: res.status, ...(data && typeof data === "object" ? data : {}) };
  const retryAfter = Number(res.headers.get("retry-after")) || undefined;
  return {
    kind: "error",
    code: `http_${res.status}`,
    message: problemMessage(problem, retryAfter, {
      429: "You've asked for many drafts in a short time. Please wait a few minutes and try again.",
    }),
    retryable: res.status === 429 || res.status >= 500,
  };
}

/**
 * Yields each non-blank line of an NDJSON body as it arrives. An event may span chunks and a
 * chunk may hold several events. The server ends every event with a newline
 * (drafts/service.ts), so a trailing partial line means the stream was cut off and is dropped.
 */
async function* readLines(body: NonNullable<Response["body"]>): AsyncGenerator<string> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (line) yield line;
    }
  }
}
