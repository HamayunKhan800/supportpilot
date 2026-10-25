"use client";

import { PenLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { streamDraft } from "@/lib/draft-stream";
import type { ApiDraft } from "@/server/modules/drafts/serialize";
import { DraftFeedback } from "./draft-feedback";
import {
  BlockedOutcome,
  ErrorOutcome,
  IdlePrompt,
  PanelAction,
  RefusedOutcome,
  StreamingPreview,
} from "./draft-outcomes";
import { afterStream, type DraftPanelState, fromDraft } from "./draft-state";
import { DraftView } from "./draft-view";

/**
 * AI reply drafts on the ticket page (M5 FR-AI3–AI8). The streamed text is a preview; the
 * checked draft replaces it when done. Screen readers hear short status messages, not every
 * word (the streaming text is not a live region).
 */
export function DraftPanel({
  ticketId,
  customerName,
  initialDraft,
  canAddArticles,
}: {
  ticketId: string;
  customerName: string;
  initialDraft: ApiDraft | null;
  /** The viewer may add help articles (shown as the next step when the AI has no sources). */
  canAddArticles: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<DraftPanelState>(
    initialDraft ? fromDraft(initialDraft) : { phase: "idle" },
  );
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
    const next = afterStream(result);
    setState(next.state);
    setAnnouncement(next.announcement);
  }

  const keepDraft = (draft: ApiDraft) => setState((s) => ("draft" in s ? { ...s, draft } : s));
  const model = "draft" in state && state.draft.model ? state.draft.model : null;

  return (
    <section
      aria-labelledby="draft-heading"
      className="bg-card text-card-foreground rounded-xl border"
      data-testid="draft-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <PenLine aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
          <h2 id="draft-heading" className="text-sm font-semibold">
            AI draft
          </h2>
          {model && (
            <span className="text-muted-foreground truncate font-mono text-xs">
              <span aria-hidden="true">· </span>
              <span className="sr-only">written by </span>
              {model}
            </span>
          )}
        </div>
        <PanelAction state={state} onStop={() => abortRef.current?.abort()} onGenerate={generate} />
      </div>

      <div className="flex flex-col gap-3 p-4">
        <p role="status" className="sr-only">
          {announcement}
        </p>

        {state.phase === "idle" && <IdlePrompt onGenerate={generate} />}

        {state.phase === "streaming" && <StreamingPreview text={state.text} />}

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
            onRegenerate={generate}
          />
        )}

        {state.phase === "refused" && (
          <RefusedOutcome errorCode={state.draft.errorCode} canAddArticles={canAddArticles} />
        )}

        {state.phase === "blocked" && <BlockedOutcome />}

        {state.phase === "error" && <ErrorOutcome message={state.message} />}

        {state.phase === "sent" && (
          <p className="enter-fade text-success-strong text-sm" data-testid="draft-outcome">
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
      </div>
    </section>
  );
}
