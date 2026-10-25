"use client";

import Link from "next/link";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { emailError } from "@/components/form-checks";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { RESET_PASSWORD_EXPIRES_IN_SECONDS } from "@/server/platform/auth/policy";

const linkClass = "text-foreground font-medium underline underline-offset-4";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [emailProblem, setEmailProblem] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { error: err } = await authClient.requestPasswordReset({
      email: String(form.get("email")).trim(),
      redirectTo: "/reset-password",
    });
    setPending(false);
    // Same message whether or not the email has an account (OWASP); only a rate limit differs.
    if (err?.status === 429) {
      setError("Too many requests. Please wait a minute and try again.");
      return;
    }
    if (err && err.status !== undefined && err.status >= 500) {
      setError("Something went wrong. Please try again.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
          <p className="text-muted-foreground text-sm">
            If an account uses that address, we&apos;ve sent it a link to choose a new password. The link
            works once, for {Math.round(RESET_PASSWORD_EXPIRES_IN_SECONDS / 60)} minutes.
          </p>
        </div>
        <p className="text-muted-foreground text-sm">
          Nothing arrived? Check spam, or{" "}
          <button type="button" className={linkClass} onClick={() => setSent(false)}>
            try again
          </button>
          .
        </p>
        <Link href="/sign-in" className={`${linkClass} text-sm`}>
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1>
        <p className="text-muted-foreground text-sm">
          Enter your email and we&apos;ll send you a link to reset it.
        </p>
      </div>
      <form method="post" onSubmit={onSubmit}>
        <div className="flex flex-col gap-4">
          <FormAlert message={error} />
          <FormField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            error={emailProblem}
            onBlur={(e) => setEmailProblem(emailError(e.currentTarget))}
            onChange={(e) => emailProblem && setEmailProblem(emailError(e.currentTarget))}
          />
        </div>
        <div className="mt-6 flex flex-col gap-4">
          <Button type="submit" size="lg" className="h-10 w-full" pending={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </Button>
          <Link href="/sign-in" className={`${linkClass} text-sm`}>
            Back to sign in
          </Link>
        </div>
      </form>
    </div>
  );
}
