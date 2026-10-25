import { describe, expect, it } from "vitest";
import { afterStream, fromDraft } from "@/app/app/(workspace)/tickets/[number]/draft-state";
import type { ApiDraft } from "@/server/modules/drafts/serialize";

/**
 * What the ticket page's draft panel shows and announces after a generation ends. Pinned before
 * the panel was split into smaller components (docs/plans/architecture-audit.md, UI round), so the
 * split cannot change it.
 */

const draft = (status: ApiDraft["status"]) => ({ id: "d1", status, body: "Hi [1]" }) as unknown as ApiDraft;

describe("fromDraft", () => {
  it.each(["ready", "refused", "blocked", "sent", "discarded"] as const)(
    "shows a %s draft as is",
    (status) => {
      const d = draft(status);
      expect(fromDraft(d)).toEqual({ phase: status, draft: d });
    },
  );

  it.each(["generating", "failed", "aborted"] as const)("shows a %s draft as a retryable error", (status) => {
    expect(fromDraft(draft(status))).toEqual({
      phase: "error",
      message: "Something went wrong while drafting. Try again.",
      retryable: true,
    });
  });
});

describe("afterStream", () => {
  it("goes back to the start, quietly saying so, when the agent stopped it", () => {
    expect(afterStream({ kind: "aborted" })).toEqual({
      state: { phase: "idle" },
      announcement: "Drafting stopped.",
    });
  });

  it("shows and announces the error message, keeping whether a retry can help", () => {
    const result = {
      kind: "error",
      code: "ai_timeout",
      message: "The AI took too long.",
      retryable: false,
    } as const;
    expect(afterStream(result)).toEqual({
      state: { phase: "error", message: "The AI took too long.", retryable: false },
      announcement: "The AI took too long.",
    });
  });

  it.each([
    ["ready", "Draft ready. Review it before sending."],
    ["refused", "Insufficient knowledge: no reliable sources found."],
    ["blocked", "The draft was blocked for safety."],
  ] as const)("shows a finished %s draft and announces it", (status, announcement) => {
    const d = draft(status);
    expect(afterStream({ kind: "done", draft: d })).toEqual({
      state: { phase: status, draft: d },
      announcement,
    });
  });

  it("announces the same error the panel shows when a draft finishes in an unexpected status", () => {
    // Was "The draft was blocked for safety." while the panel showed an error (fixed 2026-10-25).
    expect(afterStream({ kind: "done", draft: draft("failed") })).toEqual({
      state: { phase: "error", message: "Something went wrong while drafting. Try again.", retryable: true },
      announcement: "Something went wrong while drafting. Try again.",
    });
  });

  it.each(["ready", "refused", "blocked", "sent", "discarded", "failed", "generating", "aborted"] as const)(
    "never announces something different from what it shows (%s)",
    (status) => {
      const { state, announcement } = afterStream({ kind: "done", draft: draft(status) });
      expect(announcement).not.toBe("");
      if (state.phase === "error") expect(announcement).toBe(state.message);
      if (state.phase !== "blocked") expect(announcement).not.toMatch(/blocked/);
    },
  );
});
