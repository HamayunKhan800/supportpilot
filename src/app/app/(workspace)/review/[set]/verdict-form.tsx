"use client";

import { Check, X } from "lucide-react";
import { useId, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { postJson } from "@/lib/api-client";
import { REVIEW_NOTE_MAX, type ReviewSet, type ReviewVerdict } from "@/server/modules/eval-review/constants";
import type { ReviewVerdictSaved } from "@/server/modules/eval-review/schemas";
import { useProgressRouter } from "@/lib/use-progress-router";

interface Props {
  set: ReviewSet;
  id: string;
  contentHash: string;
  question: string;
  agreeLabel: string;
  disagreeLabel: string;
  verdict: ReviewVerdict | null;
  note: string | null;
}

/**
 * One tap answers the question and moves on to the next item still to review. Big buttons
 * for a phone; the optional note is sent with whichever answer is tapped.
 */
export function VerdictForm(props: Props) {
  const router = useProgressRouter();
  const noteId = useId();
  const questionId = useId();
  const [note, setNote] = useState(props.note ?? "");
  const [saving, setSaving] = useState<ReviewVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  async function answer(verdict: ReviewVerdict) {
    setSaving(verdict);
    setError(null);
    const res = await postJson<ReviewVerdictSaved>(`/api/internal/review/items/${props.id}/verdict`, {
      contentHash: props.contentHash,
      verdict,
      note: note.trim() || undefined,
    });
    if (!res.ok) {
      setSaving(null);
      setError(res.message);
      return;
    }
    const next = res.data.nextUnreviewedKey;
    setStatus(next ? "Saved. Opening the next item." : "Saved. Everything in this set is checked.");
    router.push(next ? `/app/review/${props.set}?item=${encodeURIComponent(next)}` : "/app/review");
    router.refresh();
  }

  const current =
    props.verdict === "agree" ? props.agreeLabel : props.verdict === "disagree" ? props.disagreeLabel : null;

  return (
    <div className="flex flex-col gap-4 border-t pt-4">
      <p id={questionId} className="font-medium">
        {props.question}
      </p>
      {current ? (
        <p className="text-sm" data-testid="current-verdict">
          Your answer: {current}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={noteId}>Note (optional: what&apos;s wrong, or what you&apos;d change)</Label>
        <Textarea
          id={noteId}
          value={note}
          maxLength={REVIEW_NOTE_MAX}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error ? <FormAlert message={error} /> : null}

      <div role="group" aria-labelledby={questionId} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button
          type="button"
          size="lg"
          className="h-12 text-base"
          aria-pressed={props.verdict === "agree"}
          disabled={saving !== null}
          pending={saving === "agree"}
          onClick={() => answer("agree")}
        >
          <Check aria-hidden="true" /> {saving === "agree" ? "Saving…" : props.agreeLabel}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="h-12 text-base"
          aria-pressed={props.verdict === "disagree"}
          disabled={saving !== null}
          pending={saving === "disagree"}
          onClick={() => answer("disagree")}
        >
          <X aria-hidden="true" /> {saving === "disagree" ? "Saving…" : props.disagreeLabel}
        </Button>
      </div>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  );
}
