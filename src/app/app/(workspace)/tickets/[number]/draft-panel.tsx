"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { streamDraft } from "@/lib/draft-stream";
import type { ApiDraft } from "@/server/modules/drafts/serialize";
import { BLOCKED_TEXT, REFUSAL_TEXT } from "./draft-labels";
import { DraftFeedback } from "./draft-feedback";
import { DraftView } from "./draft-view";

type State =
  | { phase: "idle" }
  | { phase: "streaming"; text: string }
  | { phase: "ready" | "refused" | "blocked" | "sent" | "discarded"; draft: ApiDraft }
  | { phase: "error"; message: string; retryable: boolean };

const fromDraft = (draft: ApiDraft): State =>
  draft.status === "ready" || draft.status === "refused" || draft.status === "blocked"
    ? { phase: draft.status, draft }
    : draft.status === "sent" || draft.status === "discarded"
      ? { phase: draft.status, draft }
      : { phase: "error", message: "Something went wrong while drafting. Try again.", retryable: true };

/**
 * AI reply drafts on the ticket page (M5 FR-AI3–AI8). The streamed text is a preview; the
 * checked draft replaces it when done. Screen readers hear short status messages, not every
 * word (the streaming text is not a live region).
 */
export function DraftPanel({
  ticketId,
  customerName,
  initialDraft,
}: {
  ticketId: string;
  customerName: string;
  initialDraft: ApiDraft | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>(initialDraft ? fromDraft(initialDraft) : { phase: "idle" });
  const [announcement, setAnnouncement] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Leaving the page cancels the generation (the server records it as aborted).
  useEffect(() => () => abortRef.current?.abort(), []);

  async function generate() {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setState({ phase: "streaming", text: "" });
    setAnnouncement("Writing a draft…");
    const result = await streamDraft(
      ticketId,
      { onDelta: (text) => setState((s) => (s.phase === "streaming" ? { ...s, text: s.text + text } : s)) },
      abort.signal,
    );
    if (abortRef.current === abort) abortRef.current = null;
    if (result.kind === "aborted") {
      setState({ phase: "idle" });
      setAnnouncement("Drafting stopped.");
    } else if (result.kind === "error") {
      setState({ phase: "error", message: result.message, retryable: result.retryable });
      setAnnouncement(result.message);
    } else {
      setState(fromDraft(result.draft));
      setAnnouncement(
        result.draft.status === "ready"
          ? "Draft ready. Review it before sending."
          : result.draft.status === "refused"
            ? "Insufficient knowledge: no reliable sources found."
            : "The draft was blocked for safety.",
      );
    }
  }

  const keepDraft = (draft: ApiDraft) => setState((s) => ("draft" in s ? { ...s, draft } : s));

  return (
    <section aria-labelledby="draft-heading" className="flex flex-col gap-3" data-testid="draft-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="draft-heading" className="text-lg font-semibold">
          AI draft
        </h2>
        {state.phase === "streaming" ? (
          <Button type="button" variant="outline" onClick={() => abortRef.current?.abort()}>
            Stop
          </Button>
        ) : state.phase !== "ready" ? (
          <Button type="button" variant={state.phase === "idle" ? "default" : "outline"} onClick={generate}>
            {state.phase === "idle"
              ? "Generate draft"
              : state.phase === "error" && state.retryable
                ? "Try again"
                : "Generate a new draft"}
          </Button>
        ) : null}
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>

      {state.phase === "idle" && (
        <p className="text-muted-foreground text-sm">
          Get a suggested reply written from your knowledge base, with its sources. You review and edit it;
          nothing is sent until you approve it.
        </p>
      )}

      {state.phase === "streaming" && (
        <div aria-busy="true" className="bg-card rounded-lg border p-3" data-testid="draft-streaming">
          <p className="text-muted-foreground mb-1 text-xs" aria-hidden="true">
            Writing…
          </p>
          <p className="break-words whitespace-pre-wrap">{state.text}</p>
        </div>
      )}

      {state.phase === "ready" && (
        <DraftView
          key={`view-${state.draft.id}`}
          draft={state.draft}
          customerName={customerName}
          onSent={(draft) => {
            setState({ phase: "sent", draft });
            setAnnouncement(`Reply sent to ${customerName}.`);
            router.refresh();
          }}
          onDiscarded={(draft) => {
            setState({ phase: "discarded", draft });
            setAnnouncement("Draft discarded.");
          }}
        />
      )}

      {state.phase === "refused" && (
        <div className="rounded-lg border p-3 text-sm" data-testid="draft-outcome">
          <p className="font-semibold">Insufficient knowledge: no reliable sources found.</p>
          <p className="mt-1">{REFUSAL_TEXT[state.draft.errorCode ?? ""] ?? REFUSAL_TEXT.below_min_score}</p>
        </div>
      )}

      {state.phase === "blocked" && (
        <div
          className="border-danger-border bg-danger-subtle text-danger-strong rounded-lg border p-3 text-sm"
          data-testid="draft-outcome"
        >
          <p className="font-semibold">Draft blocked</p>
          <p className="mt-1">{BLOCKED_TEXT}</p>
        </div>
      )}

      {state.phase === "error" && (
        <div
          className="border-danger-border bg-danger-subtle text-danger-strong rounded-lg border p-3 text-sm"
          data-testid="draft-outcome"
        >
          <p className="font-semibold">No draft this time</p>
          <p className="mt-1">{state.message}</p>
          <p className="mt-1">You can still write the reply yourself below.</p>
        </div>
      )}

      {state.phase === "sent" && (
        <p className="text-success-strong text-sm" data-testid="draft-outcome">
          Reply sent to {customerName}. It now appears in the conversation.
        </p>
      )}
      {state.phase === "discarded" && (
        <p className="text-muted-foreground text-sm" data-testid="draft-outcome">
          Draft discarded.
        </p>
      )}

      {"draft" in state && (
        <DraftFeedback key={`feedback-${state.draft.id}`} draft={state.draft} onSaved={keepDraft} />
      )}
    </section>
  );
}
