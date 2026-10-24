"use client";

import { BookX, PenLine, ShieldAlert, Square } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { streamDraft } from "@/lib/draft-stream";
import { cn } from "@/lib/utils";
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
  canAddArticles,
}: {
  ticketId: string;
  customerName: string;
  initialDraft: ApiDraft | null;
  /** The viewer may add help articles (shown as the next step when the AI has no sources). */
  canAddArticles: boolean;
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
  const model = "draft" in state && state.draft.model ? state.draft.model : null;

  return (
    <section
      aria-labelledby="draft-heading"
      className="bg-card text-card-foreground rounded-xl border"
      data-testid="draft-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="bg-brand-subtle text-brand-strong inline-flex size-6 items-center justify-center rounded-md">
            <PenLine aria-hidden="true" className="size-3.5" />
          </span>
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
        {state.phase === "streaming" ? (
          <Button type="button" variant="outline" onClick={() => abortRef.current?.abort()}>
            <Square aria-hidden="true" className="size-3 fill-current" />
            Stop
          </Button>
        ) : state.phase !== "ready" && state.phase !== "idle" ? (
          <Button type="button" variant="outline" onClick={generate}>
            {state.phase === "error" && state.retryable ? "Try again" : "Generate a new draft"}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 p-4">
        <p role="status" className="sr-only">
          {announcement}
        </p>

        {state.phase === "idle" && (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground max-w-prose text-sm">
              Get a suggested reply written from your knowledge base, with its sources. You review and edit
              it; nothing is sent until you approve it.
            </p>
            <Button type="button" size="lg" onClick={generate} className="shrink-0">
              Generate draft
            </Button>
          </div>
        )}

        {state.phase === "streaming" && (
          <div
            aria-busy="true"
            className="bg-background rounded-lg border p-3.5"
            data-testid="draft-streaming"
          >
            <p className="text-muted-foreground mb-1.5 flex items-center gap-2 text-xs" aria-hidden="true">
              <span className="bg-primary size-1.5 animate-pulse rounded-full motion-reduce:animate-none" />
              Searching your knowledge base and writing…
            </p>
            <p className="leading-relaxed break-words whitespace-pre-wrap">{state.text}</p>
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
            onRegenerate={generate}
          />
        )}

        {state.phase === "refused" && (
          <div className="flex gap-3 rounded-lg border border-dashed p-4 text-sm" data-testid="draft-outcome">
            <span className="bg-muted text-muted-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-full">
              <BookX aria-hidden="true" className="size-4" />
            </span>
            <div className="flex min-w-0 flex-col gap-2">
              <p className="font-semibold">Insufficient knowledge: no reliable sources found.</p>
              <p className="text-muted-foreground">
                {REFUSAL_TEXT[state.draft.errorCode ?? ""] ?? REFUSAL_TEXT.below_min_score}
              </p>
              <p className="text-muted-foreground text-xs">
                The AI does not guess when your articles don&apos;t cover a question.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {canAddArticles && (
                  <Link href="/app/knowledge" className={buttonVariants({ variant: "outline" })}>
                    Add a help article
                  </Link>
                )}
                <a href="#composer-heading" className={buttonVariants({ variant: "ghost" })}>
                  Write the reply yourself
                </a>
              </div>
            </div>
          </div>
        )}

        {state.phase === "blocked" && (
          <div
            className="border-danger-border bg-danger-subtle text-danger-strong flex gap-3 rounded-lg border p-4 text-sm"
            data-testid="draft-outcome"
          >
            <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">Draft blocked</p>
              <p className="mt-1">{BLOCKED_TEXT}</p>
            </div>
          </div>
        )}

        {state.phase === "error" && (
          <div
            className="border-danger-border bg-danger-subtle text-danger-strong rounded-lg border p-4 text-sm"
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
          <p className={cn("text-muted-foreground text-sm")} data-testid="draft-outcome">
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
