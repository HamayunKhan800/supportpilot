"use client";

import { Tooltip } from "@base-ui/react/tooltip";
import { CircleCheck, Pencil, RefreshCw, Send, TriangleAlert, X } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextareaField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { fieldErrors, postEmpty, postJson } from "@/lib/api-client";
import { draftChecks, excerpt } from "@/lib/draft-checks";
import { usePageShortcuts } from "@/lib/use-page-shortcuts";
import { cn } from "@/lib/utils";
import { customerCopy, splitCitations } from "@/server/modules/drafts/citations";
import type { ApiDraft } from "@/server/modules/drafts/serialize";
import { LIMITS } from "@/server/modules/tickets/limits";
import { WARNING_TEXT } from "./draft-labels";

type Citation = ApiDraft["citations"][number];

interface Props {
  draft: ApiDraft;
  customerName: string;
  onSent: (d: ApiDraft) => void;
  onDiscarded: (d: ApiDraft) => void;
  /** Called after this draft was discarded to make room for a new one. */
  onRegenerate: () => void;
}

/**
 * A ready draft (M5 FR-AI3, FR-AI5, D9). Model output is only ever rendered as text: no HTML,
 * no Markdown, links not clickable. Citation markers are buttons: hover or focus previews the
 * passage, a click opens it in the source list.
 *
 * Keys (paused while typing): E edits; A and R only move focus to Approve & send and
 * Regenerate, so sending a customer email always takes a second, deliberate key press.
 */
export function DraftView({ draft, customerName, onSent, onDiscarded, onRegenerate }: Props) {
  const ids = useId();
  const [body, setBody] = useState(draft.body);
  const [editing, setEditing] = useState(false);
  const [openSource, setOpenSource] = useState<number | null>(null);
  const [error, setError] = useState<{ form?: string; body?: string }>({});
  const [pending, setPending] = useState<"send" | "discard" | "regenerate" | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [hint, setHint] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const regenerateRef = useRef<HTMLButtonElement>(null);
  const focusAfterEdit = useRef<"editor" | "button" | null>(null);

  const byMarker = new Map(draft.citations.map((c) => [c.marker, c]));
  const preview = customerCopy(body);
  const checks = draftChecks(draft);
  const edited = body !== draft.body;
  const sourceId = (n: number) => `${ids}-source-${n}`;

  // Opening the editor puts the cursor in it; closing it returns focus to the Edit button.
  useEffect(() => {
    const target = focusAfterEdit.current;
    focusAfterEdit.current = null;
    if (target === "editor") {
      const textarea = editorRef.current?.querySelector("textarea");
      textarea?.focus();
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length); // continue at the end
    }
    if (target === "button") editButtonRef.current?.focus();
  }, [editing]);

  function toggleEditing() {
    focusAfterEdit.current = editing ? "button" : "editor";
    setEditing((e) => !e);
  }

  function focusAction(button: HTMLButtonElement | null, message: string) {
    if (!button || button.disabled) return;
    button.focus();
    button.scrollIntoView({ block: "nearest" });
    setHint(message);
  }

  usePageShortcuts(
    {
      e: () => toggleEditing(),
      a: () => focusAction(approveRef.current, `Press Enter to send the reply to ${customerName}.`),
      r: () => focusAction(regenerateRef.current, "Press Enter to write a new draft."),
    },
    pending === null,
  );

  function toggleSource(n: number) {
    setOpenSource((current) => (current === n ? null : n));
  }

  async function send() {
    if (!preview) {
      setError({ body: "Write a reply before sending." });
      focusAfterEdit.current = "editor";
      setEditing(true);
      return;
    }
    setPending("send");
    const res = await postJson<ApiDraft>(`/api/v1/drafts/${draft.id}/send`, { body });
    setPending(null);
    if (!res.ok) {
      setError({ form: res.message, ...fieldErrors(res.problem) });
      return;
    }
    onSent(res.data);
  }

  async function discard() {
    setPending("discard");
    const res = await postEmpty<ApiDraft>(`/api/v1/drafts/${draft.id}/discard`);
    setPending(null);
    if (!res.ok) {
      setError({ form: res.message });
      return;
    }
    onDiscarded(res.data);
  }

  /** Discards this draft, then asks for a new one. Edits are lost, so they need a second click. */
  async function regenerate() {
    if (edited && !confirmRegenerate) {
      setConfirmRegenerate(true);
      return;
    }
    setPending("regenerate");
    const res = await postEmpty<ApiDraft>(`/api/v1/drafts/${draft.id}/discard`);
    setPending(null);
    if (!res.ok) {
      setError({ form: res.message });
      return;
    }
    onRegenerate();
  }

  return (
    <div className="enter-fade flex flex-col gap-4">
      <ul aria-label="Automatic checks" className="flex flex-wrap gap-1.5">
        {checks.map((c) => (
          <li
            key={c.id}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs font-medium",
              c.ok
                ? "border-border text-muted-foreground"
                : "border-warning-border bg-warning-subtle text-warning-strong",
            )}
          >
            {c.ok ? (
              <CircleCheck aria-hidden="true" className="text-success-strong size-3.5" />
            ) : (
              <TriangleAlert aria-hidden="true" className="size-3.5" />
            )}
            <span className="sr-only">{c.ok ? "Passed: " : "Check: "}</span>
            {c.label}
          </li>
        ))}
      </ul>

      {draft.warnings.length > 0 && (
        <div className="border-warning-border bg-warning-subtle text-warning-strong rounded-lg border p-3 text-sm">
          <p className="font-semibold">Check before sending</p>
          <ul className="mt-1 list-disc pl-5">
            {draft.warnings.map((w) => (
              <li key={w}>{WARNING_TEXT[w] ?? w}</li>
            ))}
          </ul>
        </div>
      )}

      {editing ? (
        <div ref={editorRef}>
          <TextareaField
            label={`Edit the reply to ${customerName}`}
            name="draft-body"
            rows={10}
            maxLength={LIMITS.message}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            error={error.body}
            hint="Numbers like [1] show which source a sentence uses. They are removed before sending."
          />
        </div>
      ) : (
        <div className="bg-background rounded-lg border p-3.5 leading-relaxed" data-testid="draft-text">
          <Tooltip.Provider delay={250} closeDelay={80}>
            <p className="break-words whitespace-pre-wrap">
              {splitCitations(body).map((s, i) =>
                s.type === "text" ? (
                  <Fragment key={i}>{s.text}</Fragment>
                ) : byMarker.has(s.marker) ? (
                  <CitationMarker
                    key={i}
                    citation={byMarker.get(s.marker)!}
                    open={openSource === s.marker}
                    regionId={sourceId(s.marker)}
                    onToggle={() => toggleSource(s.marker)}
                  />
                ) : (
                  <Fragment key={i}>[{s.marker}]</Fragment>
                ),
              )}
            </p>
          </Tooltip.Provider>
        </div>
      )}

      {draft.citations.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Sources</h3>
          <ol className="flex flex-col gap-2">
            {draft.citations.map((c) => (
              <SourceItem
                key={c.marker}
                citation={c}
                open={openSource === c.marker}
                regionId={sourceId(c.marker)}
                onToggle={() => toggleSource(c.marker)}
              />
            ))}
          </ol>
        </div>
      )}

      <details open className="rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer font-medium">What {customerName} will receive</summary>
        <p className="text-muted-foreground mt-2 break-words whitespace-pre-wrap" data-testid="draft-preview">
          {preview || "(empty)"}
        </p>
      </details>

      <FormAlert message={error.form ?? ""} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={approveRef}
          type="button"
          size="lg"
          onClick={send}
          onBlur={() => setHint("")}
          disabled={pending !== null}
        >
          <Send aria-hidden="true" />
          {pending === "send" ? "Sending…" : "Approve & send"}
          <Kbd
            aria-hidden="true"
            className="border-primary-foreground/40 text-primary-foreground ml-1 hidden bg-transparent sm:inline-flex"
          >
            A
          </Kbd>
        </Button>
        <Button
          ref={editButtonRef}
          type="button"
          size="lg"
          variant="outline"
          onClick={toggleEditing}
          aria-keyshortcuts="E"
        >
          <Pencil aria-hidden="true" />
          {editing ? "Done editing" : "Edit"}
          <Kbd aria-hidden="true" className="ml-1 hidden sm:inline-flex">
            E
          </Kbd>
        </Button>
        <Button
          ref={regenerateRef}
          type="button"
          size="lg"
          variant="outline"
          onClick={regenerate}
          onBlur={() => {
            setHint("");
            setConfirmRegenerate(false);
          }}
          disabled={pending !== null}
        >
          <RefreshCw aria-hidden="true" />
          {pending === "regenerate"
            ? "Starting over…"
            : confirmRegenerate
              ? "Discard edits and regenerate"
              : "Regenerate"}
          <Kbd aria-hidden="true" className="ml-1 hidden sm:inline-flex">
            R
          </Kbd>
        </Button>
        <Button
          type="button"
          size="lg"
          variant="ghost"
          onClick={discard}
          disabled={pending !== null}
          className="sm:ml-auto"
        >
          <X aria-hidden="true" />
          {pending === "discard" ? "Discarding…" : "Discard"}
        </Button>
      </div>
      <p role="status" className={cn("text-sm", hint ? "text-foreground" : "sr-only")}>
        {confirmRegenerate ? "Your edits will be lost. Click Regenerate again to confirm." : hint}
      </p>
      <p className="text-muted-foreground text-xs">
        Written by AI from your knowledge base. It can be wrong: check it against the sources. Nothing is sent
        until you approve it.
      </p>
    </div>
  );
}

/** [1] in the draft: hover or focus shows the passage; a click opens it in the source list. */
function CitationMarker({
  citation: c,
  open,
  regionId,
  onToggle,
}: {
  citation: Citation;
  open: boolean;
  regionId: string;
  onToggle: () => void;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={regionId}
            aria-label={`Source ${c.marker}: ${c.documentTitle}`}
            className="bg-brand-subtle text-brand-strong focus-visible:ring-ring mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded px-1 align-[0.1em] text-xs leading-none font-semibold tabular-nums hover:underline focus-visible:ring-2 focus-visible:outline-none"
          />
        }
      >
        {c.marker}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" sideOffset={6} collisionPadding={12} className="z-50">
          <Tooltip.Popup className="bg-popover text-popover-foreground w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border p-3 text-sm shadow-lg transition-[opacity,scale] duration-150 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none">
            <p className="font-medium break-words">
              {c.documentTitle}
              {c.headingPath && <span className="text-muted-foreground font-normal"> › {c.headingPath}</span>}
            </p>
            <p className="text-muted-foreground mt-1.5 break-words">{excerpt(c.content)}</p>
            {c.sourceRemoved && (
              <p className="text-warning-strong mt-1.5 text-xs">
                This article changed after the draft was written.
              </p>
            )}
            <p className="text-muted-foreground mt-2 text-xs">Click to open the full passage.</p>
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function SourceItem({
  citation: c,
  open,
  regionId,
  onToggle,
}: {
  citation: Citation;
  open: boolean;
  regionId: string;
  onToggle: () => void;
}) {
  return (
    <li className="rounded-lg border text-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={regionId}
        className="hover:bg-muted focus-visible:ring-ring flex min-h-9 w-full items-start gap-2 rounded-lg p-2 text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="bg-brand-subtle text-brand-strong inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-xs font-semibold tabular-nums">
          {c.marker}
        </span>
        <span className="min-w-0 flex-1 break-words">
          {c.documentTitle}
          {c.headingPath && <span className="text-muted-foreground"> › {c.headingPath}</span>}
        </span>
        {c.sourceRemoved && (
          <Badge variant="outline" className="border-warning-border text-warning-strong">
            Source removed
          </Badge>
        )}
      </button>
      <div id={regionId} hidden={!open} className="border-t p-2">
        {c.sourceRemoved && (
          <p className="text-warning-strong mb-1 text-xs">
            This article was deleted or replaced after the draft was written. This is the passage as it was.
          </p>
        )}
        <p className="max-h-60 overflow-y-auto break-words whitespace-pre-wrap">{c.content}</p>
      </div>
    </li>
  );
}
