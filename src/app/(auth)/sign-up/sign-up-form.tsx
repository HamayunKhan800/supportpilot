"use client";

import Link from "next/link";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { emailError, nameError } from "@/components/form-checks";
import { PasswordField } from "@/components/password-field";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import type { AuthFeatures } from "@/server/platform/auth/features";
import { SocialSignIn } from "../social-sign-in";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/platform/auth/policy";
import { useProgressRouter } from "@/lib/use-progress-router";

export function SignUpForm({
  next,
  features,
  defaultEmail = "",
}: {
  next: string;
  features: AuthFeatures;
  /** From the landing page's email box (?email=); only a prefill, checked like typed input. */
  defaultEmail?: string;
}) {
  const router = useProgressRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [problems, setProblems] = useState({ name: "", email: "" });
  const check = (field: "name" | "email", el: HTMLInputElement) =>
    setProblems((p) => ({ ...p, [field]: field === "name" ? nameError(el) : emailError(el) }));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")).trim();
    const { error: err } = await authClient.signUp.email({
      name: String(form.get("name")).trim(),
      email,
      password: String(form.get("password")),
    });
    setPending(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    // Same response whether or not the email already had an account (enumeration protection).
    // With email on, the next step is the code; the owner of a taken address gets a notice.
    const params = new URLSearchParams(features.email ? { email } : { registered: "1" });
    if (next !== "/app") params.set("next", next);
    router.push(`${features.email ? "/verify-email" : "/sign-in"}?${params}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
        <p className="text-muted-foreground text-sm">Then set up a workspace for your support team.</p>
      </div>
      <SocialSignIn providers={features.socialProviders} next={next} />
      <form method="post" onSubmit={onSubmit}>
        <div className="flex flex-col gap-4">
          <FormAlert message={error} />
          <FormField
            label="Name"
            name="name"
            autoComplete="name"
            required
            minLength={1}
            maxLength={80}
            error={problems.name}
            onBlur={(e) => check("name", e.currentTarget)}
            onChange={(e) => problems.name && check("name", e.currentTarget)}
          />
          <FormField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={defaultEmail}
            error={problems.email}
            onBlur={(e) => check("email", e.currentTarget)}
            onChange={(e) => problems.email && check("email", e.currentTarget)}
          />
          <PasswordField
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            meter
            hint="A few random words make a strong, memorable passphrase."
          />
        </div>
        <div className="mt-6 flex flex-col gap-4">
          <Button type="submit" size="lg" className="h-10 w-full" pending={pending}>
            {pending ? "Creating account…" : "Create account"}
          </Button>
          <p className="text-muted-foreground text-sm">
            Already have an account?{" "}
            <Link href="/sign-in" className="text-foreground font-medium underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
