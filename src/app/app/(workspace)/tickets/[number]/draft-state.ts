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

/** What screen readers hear for a finished draft, matching what the panel shows. */
const FINISHED: Record<"ready" | "refused" | "blocked" | "sent" | "discarded", string> = {
  ready: "Draft ready. Review it before sending.",
  refused: "Insufficient knowledge: no reliable sources found.",
  blocked: "The draft was blocked for safety.",
  sent: "Reply sent.",
  discarded: "Draft discarded.",
};

/** The panel's next state and the short message screen readers hear when a generation ends. */
export function afterStream(result: DraftStreamResult): { state: DraftPanelState; announcement: string } {
  if (result.kind === "aborted") return { state: { phase: "idle" }, announcement: "Drafting stopped." };
  if (result.kind === "error") {
    return {
      state: { phase: "error", message: result.message, retryable: result.retryable },
      announcement: result.message,
    };
  }
  const state = fromDraft(result.draft);
  // Derived from the state, so the spoken message can never disagree with the screen.
  const announcement =
    state.phase === "error"
      ? state.message
      : state.phase === "idle" || state.phase === "streaming"
        ? ""
        : FINISHED[state.phase];
  return { state, announcement };
}
