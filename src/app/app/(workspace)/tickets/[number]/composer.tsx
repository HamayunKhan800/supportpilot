"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextareaField, useFocusFirstInvalid } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { fieldErrors, postJson } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { LIMITS } from "@/server/modules/tickets/limits";

type Mode = "public" | "internal";

export function Composer({
  ticketId,
  closed,
  customerName,
}: {
  ticketId: string;
  closed: boolean;
  customerName: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(closed ? "internal" : "public");
  const [body, setBody] = useState("");
  const [error, setError] = useState<{ form?: string; body?: string }>({});
  const [sent, setSent] = useState("");
  const [pending, setPending] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const formRef = useFocusFirstInvalid(failedAttempts);
  // Derived, not stored: if the ticket is closed while this page is open, the next
  // render switches to notes instead of leaving a disabled "public" choice selected.
  const internal = closed || mode === "internal";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSent("");
    if (!body.trim()) {
      setError({ body: internal ? "Write a note first." : "Write a reply first." });
      setFailedAttempts((n) => n + 1);
      return;
    }
    setPending(true);
    const res = await postJson(`/api/v1/tickets/${ticketId}/messages`, { body, internal });
    setPending(false);
    if (!res.ok) {
      setError({ form: res.message, ...fieldErrors(res.problem) });
      return;
    }
    setError({});
    setBody("");
    setSent(internal ? "Internal note added." : `Reply sent to ${customerName}.`);
    router.refresh();
  }

  return (
    <section aria-labelledby="composer-heading" className="flex flex-col gap-3">
      <h2 id="composer-heading" className="text-lg font-semibold">
        Respond
      </h2>
      <form ref={formRef} method="post" onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <FormAlert message={error.form ?? ""} />
        <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
          <legend className="sr-only">Message type</legend>
          <label className={cn("flex items-center gap-2 text-sm", closed && "text-muted-foreground")}>
            <input
              type="radio"
              name="mode"
              value="public"
              checked={!internal}
              disabled={closed}
              onChange={() => setMode("public")}
              className="size-4"
            />
            Public reply to {customerName}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              value="internal"
              checked={internal}
              onChange={() => setMode("internal")}
              className="size-4"
            />
            Internal note (team only)
          </label>
        </fieldset>
        {closed && (
          <p className="text-muted-foreground text-sm">
            This request is closed, so only internal notes can be added.
          </p>
        )}
        <TextareaField
          label={internal ? "Internal note" : `Reply to ${customerName}`}
          name="body"
          rows={5}
          required
          maxLength={LIMITS.message}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          error={error.body}
          hint={internal ? "Only your team sees this." : "The customer sees this on their tracking page."}
          className={cn(internal && "border-warning-border bg-warning-subtle")}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Saving…" : internal ? "Add internal note" : "Send reply"}
          </Button>
          <p role="status" className="text-success-strong text-sm">
            {sent}
          </p>
        </div>
      </form>
    </section>
  );
}
