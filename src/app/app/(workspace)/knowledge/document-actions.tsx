"use client";

import { RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { deleteResource, postEmpty } from "@/lib/api-client";
import { useProgressRouter } from "@/lib/use-progress-router";
import { notify } from "@/lib/toast";

/**
 * Retry (failed documents only) and delete. Delete asks first in the same dialog as removing a
 * member: focus starts on Cancel, Escape cancels, and focus returns to the button after a cancel.
 */
export function DocumentActions({ id, title, canRetry }: { id: string; title: string; canRetry: boolean }) {
  const router = useProgressRouter();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");

  async function retry() {
    setError("");
    setRetrying(true);
    const result = await postEmpty(`/api/v1/kb/documents/${id}/retry`);
    setRetrying(false);
    if (!result.ok) return setError(result.message);
    notify("Processing again", { description: `“${title}” is back in the queue.` });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {canRetry && (
          <Button onClick={retry} disabled={retrying} pending={retrying}>
            <RotateCw aria-hidden="true" />
            {retrying ? "Retrying…" : "Retry processing"}
          </Button>
        )}
        <ConfirmDialog
          trigger={<Button variant="outline" disabled={retrying} />}
          triggerLabel={
            <>
              <Trash2 aria-hidden="true" />
              Delete document
            </>
          }
          title={`Delete “${title}”?`}
          description="Its passages stop appearing in search immediately. This cannot be undone."
          confirmLabel="Delete document"
          onConfirm={async () => {
            setError("");
            const result = await deleteResource(`/api/v1/kb/documents/${id}`);
            // Already gone (404) ends in the same place: the list, which no longer shows it.
            if (!result.ok && result.problem.status !== 404) return result.message;
            router.push("/app/knowledge?deleted=1");
            router.refresh();
          }}
        />
      </div>
      <FormAlert message={error} />
    </div>
  );
}
