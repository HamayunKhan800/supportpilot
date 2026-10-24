"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/platform/auth/policy";

export function SignUpForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { error: err } = await authClient.signUp.email({
      name: String(form.get("name")).trim(),
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
    });
    setPending(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    // Same response whether or not the email already had an account (enumeration protection).
    const params = new URLSearchParams({ registered: "1" });
    if (next !== "/app") params.set("next", next);
    router.push(`/sign-in?${params}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
        <p className="text-muted-foreground text-sm">Then set up a workspace for your support team.</p>
      </div>
      <form method="post" onSubmit={onSubmit}>
        <div className="flex flex-col gap-4">
          <FormAlert message={error} />
          <FormField label="Name" name="name" autoComplete="name" required minLength={1} maxLength={80} />
          <FormField label="Email" name="email" type="email" autoComplete="email" required />
          <FormField
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters. A few random words make a strong, memorable passphrase.`}
          />
        </div>
        <div className="mt-6 flex flex-col gap-4">
          <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
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
