import { afterEach, describe, expect, it, vi } from "vitest";
import { streamDraft } from "@/lib/draft-stream";

/**
 * The browser side of the draft stream (POST /api/v1/tickets/{id}/drafts). Only the network is
 * faked: `fetch` returns real Response and ReadableStream objects, so the NDJSON parsing and the
 * failure mapping run exactly as in the browser.
 */

const encoder = new TextEncoder();
const draft = { id: "draft-1", status: "ready", body: "Hello [1]" };

/**
 * A streamed 200 response that delivers one chunk per read (an event may span chunks). With
 * `failAfter`, the read after the last chunk fails like a dropped connection; erroring up front
 * would discard the queued chunks, which is not what a network drop does.
 */
function streamed(chunks: string[], { failAfter }: { failAfter?: boolean } = {}): Response {
  const queue = [...chunks];
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      if (next !== undefined) controller.enqueue(encoder.encode(next));
      else if (failAfter) controller.error(new TypeError("network error"));
      else controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
}

const line = (event: object) => `${JSON.stringify(event)}\n`;

function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamDraft", () => {
  it("posts to the ticket's draft endpoint and reports start, each delta and the saved draft", async () => {
    const fetchMock = stubFetch(async () =>
      streamed([
        line({ type: "start", draftId: "draft-1" }),
        line({ type: "delta", text: "Hel" }),
        line({ type: "delta", text: "lo [1]" }),
        line({ type: "done", draft }),
      ]),
    );
    const starts: string[] = [];
    const deltas: string[] = [];

    const result = await streamDraft("ticket-9", {
      onStart: (id) => starts.push(id),
      onDelta: (text) => deltas.push(text),
    });

    expect(result).toEqual({ kind: "done", draft });
    expect(starts).toEqual(["draft-1"]);
    expect(deltas).toEqual(["Hel", "lo [1]"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/tickets/ticket-9/drafts",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
  });

  it("reassembles events split across chunks and splits chunks holding several events", async () => {
    const start = line({ type: "start", draftId: "draft-1" });
    const delta = line({ type: "delta", text: "Hi" });
    const done = line({ type: "done", draft });
    stubFetch(async () =>
      streamed([start.slice(0, 7), start.slice(7) + delta + done.slice(0, 12), done.slice(12)]),
    );
    const deltas: string[] = [];

    const result = await streamDraft("t", { onDelta: (text) => deltas.push(text) });

    expect(result).toEqual({ kind: "done", draft });
    expect(deltas).toEqual(["Hi"]);
  });

  it("ignores blank lines between events", async () => {
    stubFetch(async () =>
      streamed(["\n", line({ type: "start", draftId: "d" }), "  \n", line({ type: "done", draft })]),
    );
    expect(await streamDraft("t", {})).toEqual({ kind: "done", draft });
  });

  it("returns the server's error event as-is", async () => {
    stubFetch(async () =>
      streamed([
        line({ type: "start", draftId: "draft-1" }),
        line({
          type: "error",
          draftId: "draft-1",
          code: "ai_unavailable",
          message: "The AI service is unavailable right now.",
          retryable: true,
        }),
      ]),
    );

    expect(await streamDraft("t", {})).toEqual({
      kind: "error",
      code: "ai_unavailable",
      message: "The AI service is unavailable right now.",
      retryable: true,
      draftId: "draft-1",
    });
  });

  it("turns a 429 into a retryable error that says how long to wait", async () => {
    stubFetch(async () =>
      Response.json(
        { status: 429, title: "Too Many Requests" },
        { status: 429, headers: { "retry-after": "120" } },
      ),
    );

    expect(await streamDraft("t", {})).toEqual({
      kind: "error",
      code: "http_429",
      message: "Too many attempts. Please try again in 2 minutes.",
      retryable: true,
    });
  });

  it("uses the draft-specific message for a 429 without Retry-After", async () => {
    stubFetch(async () => new Response(null, { status: 429 }));
    const result = await streamDraft("t", {});
    expect(result).toMatchObject({ kind: "error", code: "http_429", retryable: true });
    expect(result.kind === "error" && result.message).toMatch(/many drafts in a short time/);
  });

  it("treats a 5xx as retryable and a 4xx as final, even with a non-JSON body", async () => {
    stubFetch(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await streamDraft("t", {})).toMatchObject({ kind: "error", code: "http_502", retryable: true });

    stubFetch(async () => Response.json({ status: 403, title: "Forbidden" }, { status: 403 }));
    expect(await streamDraft("t", {})).toMatchObject({ kind: "error", code: "http_403", retryable: false });
  });

  it("reports offline when the request can't be sent", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await streamDraft("t", {})).toEqual({
      kind: "error",
      code: "offline",
      message: "You appear to be offline. Check your connection and try again.",
      retryable: true,
    });
  });

  it("reports aborted, not offline, when the caller cancels before the response", async () => {
    const controller = new AbortController();
    stubFetch(async () => {
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    expect(await streamDraft("t", {}, controller.signal)).toEqual({ kind: "aborted" });
  });

  it("reports aborted when the caller cancels while the draft is streaming", async () => {
    const controller = new AbortController();
    stubFetch(async () => streamed([line({ type: "start", draftId: "draft-1" })], { failAfter: true }));
    const result = await streamDraft("t", { onStart: () => controller.abort() }, controller.signal);
    expect(result).toEqual({ kind: "aborted" });
  });

  it("keeps the draft id when the connection drops mid-stream", async () => {
    stubFetch(async () =>
      streamed([line({ type: "start", draftId: "draft-1" }), line({ type: "delta", text: "Hi" })], {
        failAfter: true,
      }),
    );
    expect(await streamDraft("t", {})).toMatchObject({
      kind: "error",
      code: "interrupted",
      retryable: true,
      draftId: "draft-1",
    });
  });

  it("treats a stream that ends without a final event as interrupted", async () => {
    stubFetch(async () => streamed([line({ type: "start", draftId: "draft-1" })]));
    expect(await streamDraft("t", {})).toMatchObject({
      kind: "error",
      code: "interrupted",
      draftId: "draft-1",
    });
  });

  it("treats a garbled line as interrupted rather than crashing", async () => {
    stubFetch(async () => streamed([line({ type: "start", draftId: "draft-1" }), "{not json\n"]));
    expect(await streamDraft("t", {})).toMatchObject({
      kind: "error",
      code: "interrupted",
      draftId: "draft-1",
    });
  });
});
