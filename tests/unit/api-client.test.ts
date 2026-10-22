import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteResource,
  fieldErrors,
  postForm,
  postJson,
  problemMessage,
  type ApiProblem,
} from "@/lib/api-client";

describe("problemMessage", () => {
  it("uses the server's explanation for conflicts and rejected files only", () => {
    expect(problemMessage({ status: 409, detail: "Already uploaded." })).toBe("Already uploaded.");
    expect(
      problemMessage({ status: 400, reason: "not_utf8", detail: "Text files must be saved as UTF-8." }),
    ).toBe("Text files must be saved as UTF-8.");
    // Other 400s may describe internals; keep the generic text.
    expect(problemMessage({ status: 400, detail: "Expected string at body.query" })).toBe(
      "Please check the highlighted fields.",
    );
  });

  it("turns Retry-After into minutes", () => {
    expect(problemMessage({ status: 429 }, 30)).toBe("Too many attempts. Please try again in 1 minute.");
    expect(problemMessage({ status: 429 }, 3600)).toBe("Too many attempts. Please try again in 60 minutes.");
  });

  it("explains AI provider failures and lets a caller replace a generic message", () => {
    expect(problemMessage({ status: 503 })).toMatch(/unavailable right now/);
    expect(problemMessage({ status: 502 })).toMatch(/check the AI settings/);
    expect(problemMessage({ status: 413 })).toBe("That message is too long.");
    expect(problemMessage({ status: 413 }, undefined, { 413: "Files are limited to 5 MB." })).toBe(
      "Files are limited to 5 MB.",
    );
    expect(problemMessage({ status: 500 })).toMatch(/Something went wrong/);
  });

  it("takes the first message per field", () => {
    const problem: ApiProblem = { status: 400, errors: { file: ["Empty.", "Also bad."], q: [] } };
    expect(fieldErrors(problem)).toEqual({ file: "Empty.", q: "Invalid value." });
  });
});

describe("requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
    vi.fn(
      async (..._args: Parameters<typeof fetch>) =>
        new Response(body === undefined ? null : JSON.stringify(body), { status, headers }),
    );

  it("sends JSON with the session cookie and returns the data", async () => {
    const fetchMock = respond(200, { results: [] });
    vi.stubGlobal("fetch", fetchMock);
    expect(await postJson("/api/v1/kb/search", { query: "refunds" })).toEqual({
      ok: true,
      data: { results: [] },
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", body: '{"query":"refunds"}' });
    expect((init!.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("uploads FormData without setting Content-Type (the browser adds the boundary)", async () => {
    const fetchMock = respond(201, { id: "d1" });
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.set("file", new Blob(["# Hi"]), "hi.md");
    expect(await postForm("/api/v1/kb/documents", form)).toEqual({ ok: true, data: { id: "d1" } });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init!.body).toBe(form);
    expect(init!.headers).not.toHaveProperty("content-type");
  });

  it("treats 204 as success with no body", async () => {
    vi.stubGlobal("fetch", respond(204));
    expect(await deleteResource("/api/v1/kb/documents/d1")).toEqual({ ok: true, data: undefined });
  });

  it("keeps problem extension members and applies the caller's overrides", async () => {
    vi.stubGlobal(
      "fetch",
      respond(
        409,
        { status: 409, detail: "Already uploaded.", existingDocumentId: "d0" },
        {
          "content-type": "application/problem+json",
        },
      ),
    );
    const result = await postForm("/api/v1/kb/documents", new FormData());
    expect(result).toMatchObject({
      ok: false,
      message: "Already uploaded.",
      problem: { existingDocumentId: "d0" },
    });

    vi.stubGlobal("fetch", respond(413, { status: 413 }));
    expect(await postForm("/x", new FormData(), { 413: "Files are limited to 5 MB." })).toMatchObject({
      message: "Files are limited to 5 MB.",
    });
  });

  it("reports being offline when the request cannot be sent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await postJson("/x", {})).toMatchObject({ ok: false, problem: { status: 0 }, message: /offline/ });
  });
});
