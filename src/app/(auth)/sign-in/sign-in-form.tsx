"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function SignInForm({ next, registered }: { next: string; registered: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { error: err } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
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
      <form method="post" onSubmit={onSubmit}>
        <div className="flex flex-col gap-4">
          <FormAlert
            message={registered && !error ? "Account created. Please sign in." : ""}
            tone="success"
          />
          <FormAlert message={error} />
          <FormField label="Email" name="email" type="email" autoComplete="email" required />
          <FormField
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <div className="mt-6 flex flex-col gap-4">
          <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
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
