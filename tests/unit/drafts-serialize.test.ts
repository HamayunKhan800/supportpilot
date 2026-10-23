import { describe, expect, it } from "vitest";

import { AiDraft } from "@/server/api/schemas";
import type { CitationRow, DraftRow } from "@/server/modules/drafts/repository";
import { apiDraft } from "@/server/modules/drafts/serialize";

/** The draft as the API returns it (M5 step 3–4): the strict `AiDraft` schema must accept it. */

const draft = (over: Partial<DraftRow> = {}): DraftRow => ({
  id: "6f1b8e4a-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
  workspaceId: "ws_acme",
  ticketId: "7a2c9f5b-2d3e-4f6a-9b0c-1d2e3f4a5b6c",
  requestedBy: "user_1",
  status: "ready",
  errorCode: null,
  body: "Annual plans can be refunded within 30 days [1].",
  language: "en",
  model: "gemini-3.8-flash",
  promptVersion: "draft.v1",
  retrievalTopScore: 0.81,
  invalidCitationCount: 0,
  warnings: [],
  inputTokens: 3000,
  outputTokens: 600,
  estCostMicros: 4500,
  ttftMs: 900,
  latencyMs: 4200,
  sentMessageId: null,
  editRatio: null,
  feedback: null,
  feedbackReason: null,
  feedbackNote: null,
  feedbackBy: null,
  feedbackAt: null,
  createdAt: new Date("2026-10-23T03:00:00.000Z"),
  updatedAt: new Date("2026-10-23T03:00:05.000Z"),
  ...over,
});

const citation = (over: Partial<CitationRow> = {}): CitationRow => ({
  id: "8b3d0a6c-3e4f-4a7b-8c1d-2e3f4a5b6c7d",
  workspaceId: "ws_acme",
  draftId: "6f1b8e4a-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
  marker: 1,
  chunkId: "9c4e1b7d-4f5a-4b8c-9d2e-3f4a5b6c7d8e",
  documentId: "0d5f2c8e-5a6b-4c9d-8e3f-4a5b6c7d8e9f",
  documentTitle: "billing refunds",
  headingPath: "Billing › Refunds",
  content: "Annual plans can be refunded within 30 days of purchase.",
  similarity: 0.81,
  ...over,
});

describe("apiDraft", () => {
  it("matches the strict API schema and never exposes internal columns", () => {
    const out = AiDraft.parse(apiDraft(draft(), [citation()]));
    expect(out).not.toHaveProperty("workspaceId");
    expect(out).not.toHaveProperty("requestedBy");
    expect(out).not.toHaveProperty("feedbackBy");
    expect(out.createdAt).toBe("2026-10-23T03:00:00.000Z");
    expect(out.usage).toEqual({ inputTokens: 3000, outputTokens: 600, estCostMicros: 4500 });
  });

  it("marks a citation whose passage was deleted as 'source removed' (FR-K3)", () => {
    const out = apiDraft(draft(), [citation(), citation({ marker: 2, chunkId: null, documentId: null })]);
    expect(out.citations.map((c) => c.sourceRemoved)).toEqual([false, true]);
    // The snapshot text is still there, so the agent can see what the draft relied on.
    expect(out.citations[1]!.content).toContain("refunded within 30 days");
  });

  it("feedback is null until rated, then carries the rating, reason and note", () => {
    expect(apiDraft(draft(), []).feedback).toBeNull();
    const rated = apiDraft(
      draft({ feedback: "down", feedbackReason: "incorrect", feedbackNote: "Wrong period." }),
      [],
    );
    expect(AiDraft.parse(rated).feedback).toEqual({
      rating: "down",
      reason: "incorrect",
      note: "Wrong period.",
    });
  });

  it("a refused draft (no model call) is valid too", () => {
    const refused = draft({
      status: "refused",
      errorCode: "below_min_score",
      body: "",
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      estCostMicros: 0,
      ttftMs: null,
    });
    expect(AiDraft.parse(apiDraft(refused, []))).toMatchObject({
      status: "refused",
      model: null,
      citations: [],
    });
  });
});
