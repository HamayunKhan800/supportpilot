import { describe, expect, it } from "vitest";

import { AiError } from "@/server/modules/ai/errors";
import { citationRows, draftFailure } from "@/server/modules/drafts/service";
import type { KbSearchResponse } from "@/server/modules/kb/service";

type Hit = KbSearchResponse["results"][number];

/** Only the fields citationRows reads; the rest of a search hit is irrelevant here. */
const hit = (n: number, similarity: number | null): Hit =>
  ({
    rank: n,
    chunk: { id: `chunk-${n}`, headingPath: ["Billing", `Topic ${n}`], content: `Passage ${n}` },
    document: { id: `doc-${n}`, title: `Article ${n}` },
    vector: similarity === null ? null : { similarity },
  }) as unknown as Hit;

describe("citationRows (what a ready draft stores per [n] marker)", () => {
  const results = [hit(1, 0.91), hit(2, 0.8), hit(3, null)];

  it("copies the passage behind each cited marker, in citation order", () => {
    expect(citationRows([3, 1], results)).toEqual([
      {
        marker: 3,
        chunkId: "chunk-3",
        documentId: "doc-3",
        documentTitle: "Article 3",
        headingPath: ["Billing", "Topic 3"],
        content: "Passage 3",
        similarity: null, // keyword-only hit: no vector score
      },
      {
        marker: 1,
        chunkId: "chunk-1",
        documentId: "doc-1",
        documentTitle: "Article 1",
        headingPath: ["Billing", "Topic 1"],
        content: "Passage 1",
        similarity: 0.91,
      },
    ]);
  });

  it("stores nothing when the draft cites nothing", () => {
    expect(citationRows([], results)).toEqual([]);
  });
});

describe("draftFailure (how a failed draft is recorded)", () => {
  it("keeps the AI error's own code", () => {
    expect(draftFailure(new AiError("ai_daily_limit"), false)).toEqual({
      code: "ai_daily_limit",
      status: "failed",
    });
  });

  it("records an AI abort as aborted, not failed", () => {
    expect(draftFailure(new AiError("ai_aborted"), true)).toEqual({ code: "ai_aborted", status: "aborted" });
  });

  it("treats any other error after the client left as a cancellation", () => {
    expect(draftFailure(new Error("Controller is already closed"), true)).toEqual({
      code: "ai_aborted",
      status: "aborted",
    });
  });

  it("treats any other error while the client is still there as a bug", () => {
    expect(draftFailure(new TypeError("x is undefined"), false)).toEqual({
      code: "internal_error",
      status: "failed",
    });
  });
});
