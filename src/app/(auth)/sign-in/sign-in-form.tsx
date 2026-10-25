"use client";

import Link from "next/link";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { emailError } from "@/components/form-checks";
import { PasswordField } from "@/components/password-field";
import { Button } from "@/components/ui/button";
import type { AuthFeatures } from "@/server/platform/auth/features";
import { SocialSignIn } from "../social-sign-in";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { useProgressRouter } from "@/lib/use-progress-router";

export function SignInForm({
  next,
  notice,
  providerError,
  features,
}: {
  next: string;
  /** A fixed success message from the page (account created, password changed). */
  notice: string;
  /** A fixed message after a failed Google or GitHub sign-in. */
  providerError: string;
  features: AuthFeatures;
}) {
  const router = useProgressRouter();
  const [error, setError] = useState(providerError);
  const [pending, setPending] = useState(false);
  const [emailProblem, setEmailProblem] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { error: err } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (err?.code === "EMAIL_NOT_VERIFIED") {
      // The password was right; the server has just emailed a fresh code.
      const params = new URLSearchParams({ email: String(form.get("email")).trim(), from: "sign-in" });
      if (next !== "/app") params.set("next", next);
      router.push(`/verify-email?${params}`);
      return;
    }
    if (err) {
      setPending(false);
      setError(authErrorMessage(err));
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground text-sm">Sign in to your support workspace.</p>
      </div>
      <SocialSignIn providers={features.socialProviders} next={next} />
      <form method="post" onSubmit={onSubmit}>
        <div className="flex flex-col gap-4">
          <FormAlert message={notice && !error ? notice : ""} tone="success" />
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
          <div className="flex flex-col gap-2">
            <PasswordField autoComplete="current-password" />
            {features.email && (
              <Link
                href="/forgot-password"
                className="text-muted-foreground hover:text-foreground self-end py-0.5 text-sm underline underline-offset-4"
              >
                Forgot password?
              </Link>
            )}
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-4">
          <Button type="submit" size="lg" className="h-10 w-full" pending={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-muted-foreground text-sm">
            New here?{" "}
            <Link
              href={`/sign-up${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`}
              className="text-foreground font-medium underline underline-offset-4"
            >
              Create an account
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
