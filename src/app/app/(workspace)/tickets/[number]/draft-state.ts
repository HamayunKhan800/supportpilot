import type { DraftStreamResult } from "@/lib/draft-stream";
import type { ApiDraft } from "@/server/modules/drafts/serialize";

/** What the draft panel is showing. Pure, so the decisions below are unit-tested. */
export type DraftPanelState =
  | { phase: "idle" }
  | { phase: "streaming"; text: string }
  | { phase: "ready" | "refused" | "blocked" | "sent" | "discarded"; draft: ApiDraft }
  | { phase: "error"; message: string; retryable: boolean };

export const fromDraft = (draft: ApiDraft): DraftPanelState =>
  draft.status === "ready" || draft.status === "refused" || draft.status === "blocked"
    ? { phase: draft.status, draft }
    : draft.status === "sent" || draft.status === "discarded"
      ? { phase: draft.status, draft }
      : { phase: "error", message: "Something went wrong while drafting. Try again.", retryable: true };

/** The panel's next state and the short message screen readers hear when a generation ends. */
export function afterStream(result: DraftStreamResult): { state: DraftPanelState; announcement: string } {
  if (result.kind === "aborted") return { state: { phase: "idle" }, announcement: "Drafting stopped." };
  if (result.kind === "error") {
    return {
      state: { phase: "error", message: result.message, retryable: result.retryable },
      announcement: result.message,
    };
  }
  return {
    state: fromDraft(result.draft),
    announcement:
      result.draft.status === "ready"
        ? "Draft ready. Review it before sending."
        : result.draft.status === "refused"
          ? "Insufficient knowledge: no reliable sources found."
          : "The draft was blocked for safety.",
  };
}
