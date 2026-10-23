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

  if (!res.ok || !res.body) {
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

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let draftId: string | undefined;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const event = JSON.parse(line) as DraftEvent;
        if (event.type === "start") {
          draftId = event.draftId;
          handlers.onStart?.(event.draftId);
        } else if (event.type === "delta") handlers.onDelta?.(event.text);
        else if (event.type === "done") return { kind: "done", draft: event.draft };
        else if (event.type === "error") {
          return {
            kind: "error",
            code: event.code,
            message: event.message,
            retryable: event.retryable,
            draftId: event.draftId,
          };
        }
      }
    }
  } catch {
    if (signal?.aborted) return { kind: "aborted" };
    return { kind: "error", code: "interrupted", message: INTERRUPTED, retryable: true, draftId };
  }
  return { kind: "error", code: "interrupted", message: INTERRUPTED, retryable: true, draftId };
}
