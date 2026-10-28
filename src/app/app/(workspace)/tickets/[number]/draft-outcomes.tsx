import { BookX, ShieldAlert, Square } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ApiDraft } from "@/server/modules/drafts/serialize";
import { BLOCKED_TEXT, REFUSAL_TEXT } from "./draft-labels";
import type { DraftPanelState } from "./draft-state";

/** The draft panel's states other than a ready draft (that one is DraftView). */

/** The button in the panel's header: Stop while writing, otherwise a way to start again (none at the start or on a ready draft). */
export function PanelAction({
  state,
  onStop,
  onGenerate,
}: {
  state: DraftPanelState;
  onStop: () => void;
  onGenerate: () => void;
}) {
  if (state.phase === "streaming") {
    return (
      <Button type="button" variant="outline" onClick={onStop}>
        <Square aria-hidden="true" className="size-3 fill-current" />
        Stop
      </Button>
    );
  }
  if (state.phase === "ready" || state.phase === "idle") return null;
  return (
    <Button type="button" variant="outline" onClick={onGenerate}>
      {state.phase === "error" && state.retryable ? "Try again" : "Generate a new draft"}
    </Button>
  );
}

export function IdlePrompt({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground max-w-measure text-sm">
        Get a suggested reply written from your knowledge base, with its sources. You review and edit it;
        nothing is sent until you approve it.
      </p>
      <Button type="button" size="lg" onClick={onGenerate} className="shrink-0">
        Generate draft
      </Button>
    </div>
  );
}

/** The words as they arrive: a preview only (not a live region); the checked draft replaces it. */
export function StreamingPreview({ text }: { text: string }) {
  return (
    <div
      aria-busy="true"
      className="enter-fade bg-background rounded-lg border p-3.5"
      data-testid="draft-streaming"
    >
      <p className="text-muted-foreground mb-1.5 flex items-center gap-2 text-xs" aria-hidden="true">
        <span className="bg-primary size-1.5 animate-pulse rounded-full motion-reduce:animate-none" />
        Searching your knowledge base and writing…
      </p>
      {text ? (
        <p className="leading-relaxed break-words whitespace-pre-wrap">
          {text}
          <span aria-hidden="true" className="stream-caret" />
        </p>
      ) : (
        // Before the first words arrive: the shape of a reply, not a spinner.
        <div aria-hidden="true" className="flex flex-col gap-2 py-1" data-testid="draft-skeleton">
          <div className="skeleton h-3.5 w-full" />
          <div className="skeleton h-3.5 w-11/12" />
          <div className="skeleton h-3.5 w-3/5" />
        </div>
      )}
    </div>
  );
}

export function RefusedOutcome({
  errorCode,
  canAddArticles,
}: {
  errorCode: ApiDraft["errorCode"];
  canAddArticles: boolean;
}) {
  return (
    <div
      className="enter-fade flex gap-3 rounded-lg border border-dashed p-4 text-sm"
      data-testid="draft-outcome"
    >
      <BookX aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="font-semibold">Insufficient knowledge: no reliable sources found.</p>
        <p className="text-muted-foreground">
          {REFUSAL_TEXT[errorCode ?? ""] ?? REFUSAL_TEXT.below_min_score}
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
  );
}

export function BlockedOutcome() {
  return (
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
  );
}

export function ErrorOutcome({ message }: { message: string }) {
  return (
    <div
      className="border-danger-border bg-danger-subtle text-danger-strong rounded-lg border p-4 text-sm"
      data-testid="draft-outcome"
    >
      <p className="font-semibold">No draft this time</p>
      <p className="mt-1">{message}</p>
      <p className="mt-1">You can still write the reply yourself below.</p>
    </div>
  );
}
