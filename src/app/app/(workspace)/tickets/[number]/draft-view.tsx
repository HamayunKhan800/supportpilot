"use client";

import { Fragment, useId, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextareaField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fieldErrors, postEmpty, postJson } from "@/lib/api-client";
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
}

/**
 * A ready draft (M5 FR-AI3, FR-AI5, D9). Model output is only ever rendered as text: no HTML,
 * no Markdown, links not clickable. Citation markers become buttons that open the passage.
 */
export function DraftView({ draft, customerName, onSent, onDiscarded }: Props) {
  const ids = useId();
  const [body, setBody] = useState(draft.body);
  const [editing, setEditing] = useState(false);
  const [openSource, setOpenSource] = useState<number | null>(null);
  const [error, setError] = useState<{ form?: string; body?: string }>({});
  const [pending, setPending] = useState<"send" | "discard" | null>(null);
  const byMarker = new Map(draft.citations.map((c) => [c.marker, c]));
  const preview = customerCopy(body);
  const sourceId = (n: number) => `${ids}-source-${n}`;

  function toggleSource(n: number) {
    setOpenSource((current) => (current === n ? null : n));
  }

  async function send() {
    if (!preview) {
      setError({ body: "Write a reply before sending." });
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

  return (
    <div className="flex flex-col gap-4">
      {draft.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-semibold">Check before sending</p>
          <ul className="mt-1 list-disc pl-5">
            {draft.warnings.map((w) => (
              <li key={w}>{WARNING_TEXT[w] ?? w}</li>
            ))}
          </ul>
        </div>
      )}

      {editing ? (
        <TextareaField
          label={`Edit the reply to ${customerName}`}
          name="draft-body"
          rows={8}
          maxLength={LIMITS.message}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          error={error.body}
          hint="Numbers like [1] show which source a sentence uses. They are removed before sending."
        />
      ) : (
        <div className="rounded-lg border bg-white p-3" data-testid="draft-text">
          <p className="break-words whitespace-pre-wrap">
            {splitCitations(body).map((s, i) =>
              s.type === "text" ? (
                <Fragment key={i}>{s.text}</Fragment>
              ) : byMarker.has(s.marker) ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleSource(s.marker)}
                  aria-expanded={openSource === s.marker}
                  aria-controls={sourceId(s.marker)}
                  aria-label={`Source ${s.marker}: ${byMarker.get(s.marker)!.documentTitle}`}
                  className="mx-0.5 rounded bg-blue-100 px-1 align-baseline text-xs font-semibold text-blue-900 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
                >
                  [{s.marker}]
                </button>
              ) : (
                <Fragment key={i}>[{s.marker}]</Fragment>
              ),
            )}
          </p>
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
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="lg" onClick={send} disabled={pending !== null}>
          {pending === "send" ? "Sending…" : "Approve & send"}
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={() => setEditing((e) => !e)}>
          {editing ? "Done editing" : "Edit"}
        </Button>
        <Button type="button" size="lg" variant="ghost" onClick={discard} disabled={pending !== null}>
          {pending === "discard" ? "Discarding…" : "Discard"}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Written by AI from your knowledge base. Nothing is sent until you approve it.
      </p>
    </div>
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
        className="flex w-full items-start gap-2 p-2 text-left hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none"
      >
        <span className="font-semibold text-blue-900">[{c.marker}]</span>
        <span className="min-w-0 flex-1 break-words">
          {c.documentTitle}
          {c.headingPath && <span className="text-muted-foreground"> › {c.headingPath}</span>}
        </span>
        {c.sourceRemoved && (
          <Badge variant="outline" className="border-amber-400 text-amber-900">
            Source removed
          </Badge>
        )}
      </button>
      <div id={regionId} hidden={!open} className={cn("border-t p-2")}>
        {c.sourceRemoved && (
          <p className="mb-1 text-xs text-amber-900">
            This article was deleted or replaced after the draft was written. This is the passage as it was.
          </p>
        )}
        <p className="max-h-60 overflow-y-auto break-words whitespace-pre-wrap">{c.content}</p>
      </div>
    </li>
  );
}
