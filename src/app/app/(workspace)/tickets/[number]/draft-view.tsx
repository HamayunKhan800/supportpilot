"use client";

import { CircleCheck, Pencil, RefreshCw, Send, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-alert";
import { TextareaField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { fieldErrors, postEmpty, postJson } from "@/lib/api-client";
import { draftChecks } from "@/lib/draft-checks";
import { usePageShortcuts } from "@/lib/use-page-shortcuts";
import { cn } from "@/lib/utils";
import { customerCopy } from "@/server/modules/drafts/citations";
import type { ApiDraft } from "@/server/modules/drafts/serialize";
import { LIMITS } from "@/server/modules/tickets/limits";
import { WARNING_TEXT } from "./draft-labels";
import { DraftText, SourceList } from "./draft-sources";

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
  const { editing, toggleEditing, openEditor, editorRef, editButtonRef } = useEditToggle();
  const [openSource, setOpenSource] = useState<number | null>(null);
  const [error, setError] = useState<{ form?: string; body?: string }>({});
  const [pending, setPending] = useState<"send" | "discard" | "regenerate" | null>(null);
  // Edits would be lost, so Regenerate and Discard ask first (the app's usual confirm dialog).
  const [confirming, setConfirming] = useState<"regenerate" | "discard" | null>(null);
  const [hint, setHint] = useState("");
  const approveRef = useRef<HTMLButtonElement>(null);
  const regenerateRef = useRef<HTMLButtonElement>(null);

  const preview = customerCopy(body);
  const checks = draftChecks(draft);
  const edited = body !== draft.body;
  const sourceId = (n: number) => `${ids}-source-${n}`;

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

  const sources = {
    openSource,
    regionId: sourceId,
    onToggle: (n: number) => setOpenSource((current) => (current === n ? null : n)),
  };

  async function send() {
    if (!preview) {
      setError({ body: "Write a reply before sending." });
      openEditor();
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
    if (edited) return setConfirming("discard");
    setPending("discard");
    const res = await postEmpty<ApiDraft>(`/api/v1/drafts/${draft.id}/discard`);
    setPending(null);
    if (!res.ok) {
      setError({ form: res.message });
      return;
    }
    onDiscarded(res.data);
  }

  /** Discards this draft, then asks for a new one. */
  async function regenerate() {
    if (edited) return setConfirming("regenerate");
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
      <AutomaticChecks checks={checks} />
      {draft.warnings.length > 0 && <DraftWarnings warnings={draft.warnings} />}

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
        <DraftText body={body} citations={draft.citations} {...sources} />
      )}

      {draft.citations.length > 0 && <SourceList citations={draft.citations} {...sources} />}

      <CustomerPreview customerName={customerName} preview={preview} />

      <FormAlert message={error.form ?? ""} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={approveRef}
          type="button"
          size="lg"
          onClick={send}
          onBlur={() => setHint("")}
          disabled={pending !== null}
          pending={pending === "send"}
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
          onBlur={() => setHint("")}
          disabled={pending !== null}
          pending={pending === "regenerate"}
        >
          <RefreshCw aria-hidden="true" />
          {pending === "regenerate" ? "Starting over…" : "Regenerate"}
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
          pending={pending === "discard"}
          className="sm:ml-auto"
        >
          <X aria-hidden="true" />
          {pending === "discard" ? "Discarding…" : "Discard"}
        </Button>
      </div>
      <p role="status" className={cn("text-sm", hint ? "text-foreground" : "sr-only")}>
        {hint}
      </p>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Discard your edits?"
        description={
          confirming === "regenerate"
            ? "A new draft replaces this one, and the changes you made are lost."
            : "The draft and the changes you made are removed. You can write the reply yourself."
        }
        cancelLabel="Keep editing"
        confirmLabel={confirming === "regenerate" ? "Discard and regenerate" : "Discard draft"}
        onConfirm={async () => {
          const res = await postEmpty<ApiDraft>(`/api/v1/drafts/${draft.id}/discard`);
          if (!res.ok) return res.message;
          if (confirming === "regenerate") onRegenerate();
          else onDiscarded(res.data);
        }}
      />
      <p className="text-muted-foreground text-xs">
        Written by AI from your knowledge base. It can be wrong: check it against the sources. Nothing is sent
        until you approve it.
      </p>
    </div>
  );
}

/**
 * Edit mode, with focus where the agent expects it: opening the editor puts the cursor at the end
 * of the text; closing it returns focus to the Edit button.
 */
function useEditToggle() {
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const focusAfterEdit = useRef<"editor" | "button" | null>(null);

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

  function openEditor() {
    focusAfterEdit.current = "editor";
    setEditing(true);
  }

  return { editing, toggleEditing, openEditor, editorRef, editButtonRef };
}

function AutomaticChecks({ checks }: { checks: ReturnType<typeof draftChecks> }) {
  return (
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
  );
}

function DraftWarnings({ warnings }: { warnings: ApiDraft["warnings"] }) {
  return (
    <div className="border-warning-border bg-warning-subtle text-warning-strong rounded-lg border p-3 text-sm">
      <p className="font-semibold">Check before sending</p>
      <ul className="mt-1 list-disc pl-5">
        {warnings.map((w) => (
          <li key={w}>{WARNING_TEXT[w] ?? w}</li>
        ))}
      </ul>
    </div>
  );
}

/** Exactly what the customer gets: the draft with its [n] markers removed. */
function CustomerPreview({ customerName, preview }: { customerName: string; preview: string }) {
  return (
    <details open className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">What {customerName} will receive</summary>
      <p className="text-muted-foreground mt-2 break-words whitespace-pre-wrap" data-testid="draft-preview">
        {preview || "(empty)"}
      </p>
    </details>
  );
}
