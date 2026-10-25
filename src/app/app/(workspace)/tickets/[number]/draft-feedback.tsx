"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useId, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { postJson } from "@/lib/api-client";
import type { ApiDraft } from "@/server/modules/drafts/serialize";
import { FEEDBACK_REASONS } from "./draft-labels";

type Reason = (typeof FEEDBACK_REASONS)[number]["value"];

/** Helpful / not helpful, with an optional reason (FR-AI6). Works for any finished draft, refused ones included. */
export function DraftFeedback({ draft, onSaved }: { draft: ApiDraft; onSaved: (d: ApiDraft) => void }) {
  const ids = useId();
  const [rating, setRating] = useState(draft.feedback?.rating ?? null);
  const [reason, setReason] = useState<Reason | "">((draft.feedback?.reason as Reason | null) ?? "");
  const [note, setNote] = useState(draft.feedback?.note ?? "");
  const [askReason, setAskReason] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function save(next: "up" | "down", withReason = false) {
    setPending(true);
    setError("");
    const res = await postJson<ApiDraft>(`/api/v1/drafts/${draft.id}/feedback`, {
      rating: next,
      ...(withReason && reason ? { reason } : {}),
      ...(withReason && note.trim() ? { note: note.trim() } : {}),
    });
    setPending(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setRating(next);
    setAskReason(false);
    setStatus("Thanks for the feedback.");
    onSaved(res.data);
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div role="group" aria-labelledby={`${ids}-q`} className="flex flex-wrap items-center gap-2">
        <span id={`${ids}-q`} className="text-sm">
          Was this draft helpful?
        </span>
        <Button
          type="button"
          size="sm"
          variant={rating === "up" ? "secondary" : "outline"}
          aria-pressed={rating === "up"}
          disabled={pending}
          onClick={() => save("up")}
        >
          <ThumbsUp aria-hidden="true" /> Helpful
        </Button>
        <Button
          type="button"
          size="sm"
          variant={rating === "down" ? "secondary" : "outline"}
          aria-pressed={rating === "down"}
          aria-expanded={askReason}
          aria-controls={`${ids}-why`}
          disabled={pending}
          onClick={() => {
            setStatus("");
            setAskReason(true);
          }}
        >
          <ThumbsDown aria-hidden="true" /> Not helpful
        </Button>
      </div>
      {askReason && (
        <form
          method="post"
          id={`${ids}-why`}
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save("down", true);
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-reason`}>What was wrong? (optional)</Label>
            <select
              id={`${ids}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value as Reason | "")}
              className="border-input bg-background field-focus h-9 rounded-lg border px-2 text-sm"
            >
              <option value="">Choose a reason</option>
              {FEEDBACK_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-note`}>Details (optional, your team only)</Label>
            <Textarea
              id={`${ids}-note`}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" pending={pending}>
              Send feedback
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAskReason(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <FormAlert message={error} />
      <p role="status" className="text-success-strong text-sm">
        {status}
      </p>
    </div>
  );
}
