"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextareaField, useFocusFirstInvalid } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { fieldErrors, postJson } from "@/lib/api-client";
import { LIMITS } from "@/server/modules/tickets/limits";

export function ReplyForm({ token }: { token: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<{ form?: string; message?: string }>({});
  const [sent, setSent] = useState("");
  const [pending, setPending] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const formRef = useFocusFirstInvalid(failedAttempts);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSent("");
    if (!message.trim()) {
      setError({ message: "Write a reply first." });
      setFailedAttempts((n) => n + 1);
      return;
    }
    setPending(true);
    const res = await postJson(`/api/v1/portal/t/${encodeURIComponent(token)}/messages`, { message });
    setPending(false);
    if (!res.ok) {
      setError({ form: res.message, ...fieldErrors(res.problem) });
      return;
    }
    setError({});
    setMessage("");
    setSent("Reply sent.");
    router.refresh(); // re-render the conversation from the server
  }

  return (
    <section aria-labelledby="reply-heading" className="flex flex-col gap-3">
      <h2 id="reply-heading" className="text-lg font-semibold">
        Reply
      </h2>
      <form ref={formRef} method="post" onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <FormAlert message={error.form ?? ""} />
        <TextareaField
          label="Your reply"
          name="message"
          rows={4}
          required
          maxLength={LIMITS.message}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          error={error.message}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Sending…" : "Send reply"}
          </Button>
          <p role="status" className="text-sm text-green-800">
            {sent}
          </p>
        </div>
      </form>
    </section>
  );
}
