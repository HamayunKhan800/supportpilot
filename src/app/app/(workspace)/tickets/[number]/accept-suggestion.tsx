"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api-client";

/** "Accept suggestion": applies the AI's category and priority as this agent (FR-AI2). */
export function AcceptSuggestion({ ticketId, version }: { ticketId: string; version: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);

  async function accept() {
    setPending(true);
    setError("");
    const res = await postJson(`/api/v1/tickets/${ticketId}/triage/accept`, { version });
    setPending(false);
    if (!res.ok) {
      setError(res.message);
      setConflict(res.problem.status === 409);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <FormAlert message={error} />
      {conflict ? (
        <Button type="button" variant="outline" onClick={() => router.refresh()}>
          Load latest version
        </Button>
      ) : (
        <Button type="button" onClick={accept} disabled={pending}>
          {pending ? "Accepting…" : "Accept suggestion"}
        </Button>
      )}
    </div>
  );
}
