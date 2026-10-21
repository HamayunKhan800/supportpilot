"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <h1 className="text-xl leading-snug font-semibold">Sign in</h1>
        <CardDescription>Welcome back. Sign in to your workspace.</CardDescription>
      </CardHeader>
      <form method="post" onSubmit={onSubmit}>
        <CardContent className="flex flex-col gap-4">
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
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-3">
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-muted-foreground text-sm">
            New here?{" "}
            <Link
              href={`/sign-up${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`}
              className="underline"
            >
              Create an account
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
