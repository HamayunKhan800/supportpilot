"use client";

import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/platform/auth/policy";

export function ChangePasswordForm() {
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setError("");
    setDone("");
    setPending(true);
    const { error: err } = await authClient.changePassword({
      currentPassword: String(form.get("currentPassword")),
      newPassword: String(form.get("newPassword")),
      revokeOtherSessions: true, // also enforced server-side
    });
    setPending(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    formEl.reset();
    setDone("Password changed. You have been signed out on all other devices.");
  }

  return (
    <form method="post" onSubmit={onSubmit} className="flex max-w-md flex-col gap-4">
      <FormAlert message={error} />
      <FormAlert message={done} tone="success" />
      <FormField
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormField
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
      />
      <Button type="submit" size="lg" className="h-10 self-start" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
