"use client";

import Link from "next/link";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { PasswordField } from "@/components/password-field";
import { Button } from "@/components/ui/button";
import { authErrorMessage, authClient } from "@/lib/auth-client";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/platform/auth/policy";
import { useProgressRouter } from "@/lib/use-progress-router";

const linkClass = "text-foreground font-medium underline underline-offset-4";

function ExpiredLink() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">This link has expired</h1>
        <p className="text-muted-foreground text-sm">
          Reset links work once, for a short time. Ask for a new one and use the newest email.
        </p>
      </div>
      <Link href="/forgot-password" className={`${linkClass} text-sm`}>
        Send a new reset link
      </Link>
    </div>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useProgressRouter();
  const [error, setError] = useState("");
  const [mismatch, setMismatch] = useState("");
  const [expired, setExpired] = useState(!token);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get("password"));
    // Typed twice (OWASP), so a typo can't lock the person out again.
    if (newPassword !== String(form.get("confirmPassword"))) {
      setMismatch("The passwords don't match.");
      return;
    }
    setMismatch("");
    setPending(true);
    const { error: err } = await authClient.resetPassword({ newPassword, token });
    if (err) {
      setPending(false);
      if (err.code === "INVALID_TOKEN") setExpired(true);
      else setError(authErrorMessage(err));
      return;
    }
    // No automatic sign-in (OWASP): every session was signed out, so sign in afresh.
    router.replace("/sign-in?notice=password-reset");
  }

  if (expired) return <ExpiredLink />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-muted-foreground text-sm">
          You&apos;ll be signed out everywhere, then you can sign in.
        </p>
      </div>
      <form method="post" onSubmit={onSubmit}>
        <div className="flex flex-col gap-4">
          <FormAlert message={error} />
          <PasswordField
            label="New password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            meter
            hint="A few random words make a strong, memorable passphrase."
          />
          <PasswordField
            label="Confirm new password"
            name="confirmPassword"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX_LENGTH}
            error={mismatch}
          />
        </div>
        <div className="mt-6">
          <Button type="submit" size="lg" className="h-10 w-full" pending={pending}>
            {pending ? "Saving…" : "Save new password"}
          </Button>
        </div>
      </form>
    </div>
  );
}
