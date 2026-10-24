"use client";

import { RotateCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { deleteResource, postEmpty } from "@/lib/api-client";
import { useProgressRouter } from "@/lib/use-progress-router";
import { notify } from "@/lib/toast";

/** Retry (failed documents only) and delete with an inline confirmation step. */
export function DocumentActions({ id, title, canRetry }: { id: string; title: string; canRetry: boolean }) {
  const router = useProgressRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<"retry" | "delete" | null>(null);
  const [error, setError] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);

  // Keyboard and screen-reader users land on the decision, and back on Delete if they cancel.
  useEffect(() => {
    if (confirming) {
      opened.current = true;
      confirmRef.current?.focus();
    } else if (opened.current) deleteRef.current?.focus();
  }, [confirming]);

  async function retry() {
    setError("");
    setPending("retry");
    const result = await postEmpty(`/api/v1/kb/documents/${id}/retry`);
    setPending(null);
    if (!result.ok) return setError(result.message);
    notify("Processing again", { description: `“${title}” is back in the queue.` });
    router.refresh();
  }

  async function remove() {
    setError("");
    setPending("delete");
    const result = await deleteResource(`/api/v1/kb/documents/${id}`);
    if (!result.ok && result.problem.status !== 404) {
      setPending(null);
      setConfirming(false);
      return setError(result.message);
    }
    // Already gone (404) ends in the same place: the list, which no longer shows it.
    router.push("/app/knowledge?deleted=1");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {confirming ? (
        <div
          role="group"
          aria-labelledby="confirm-delete-text"
          className="border-danger-border bg-danger-subtle flex flex-col gap-3 rounded-xl border p-4"
        >
          <p id="confirm-delete-text" className="text-sm">
            Delete “{title}”? Its passages stop appearing in search immediately. This cannot be undone.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button ref={confirmRef} variant="destructive" onClick={remove} disabled={pending !== null}>
              <Trash2 aria-hidden="true" />
              {pending === "delete" ? "Deleting…" : "Yes, delete"}
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending !== null}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canRetry && (
            <Button onClick={retry} disabled={pending !== null}>
              <RotateCw aria-hidden="true" />
              {pending === "retry" ? "Retrying…" : "Retry processing"}
            </Button>
          )}
          <Button
            ref={deleteRef}
            variant="outline"
            onClick={() => setConfirming(true)}
            disabled={pending !== null}
          >
            <Trash2 aria-hidden="true" />
            Delete document
          </Button>
        </div>
      )}
      <FormAlert message={error} />
    </div>
  );
}
