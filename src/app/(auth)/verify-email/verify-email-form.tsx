"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { useProgressRouter } from "@/lib/use-progress-router";
import {
  VERIFICATION_CODE_EXPIRES_IN_SECONDS,
  VERIFICATION_CODE_LENGTH,
  VERIFICATION_RESEND_COOLDOWN_SECONDS,
} from "@/server/platform/auth/policy";

const linkClass = "text-foreground font-medium underline underline-offset-4";

/** Seconds left before "Send a new code" works again; ticks once a second while waiting. */
function useCooldown() {
  const [endsAt, setEndsAt] = useState(() => Date.now() + VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000);
  const [now, setNow] = useState(() => Date.now());
  const waiting = now < endsAt;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);
  return {
    secondsLeft: Math.max(0, Math.ceil((endsAt - now) / 1000)),
    restart: () => {
      const t = Date.now();
      setNow(t);
      setEndsAt(t + VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000);
    },
  };
}

export function VerifyEmailForm({
  email,
  next,
  fromSignIn,
}: {
  email: string;
  next: string;
  fromSignIn: boolean;
}) {
  const router = useProgressRouter();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState(false);
  const cooldown = useCooldown();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setStatus("");
    setPending(true);
    const otp = String(new FormData(e.currentTarget).get("code")).replace(/\s/g, "");
    const { error: err } = await authClient.emailOtp.verifyEmail({ email, otp });
    if (err) {
      setPending(false);
      setError(authErrorMessage(err));
      return;
    }
    const params = new URLSearchParams({ notice: "email-verified" });
    if (next !== "/app") params.set("next", next);
    router.replace(`/sign-in?${params}`);
  }

  async function resend() {
    setError("");
    setStatus("");
    setSending(true);
    const { error: err } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "email-verification",
    });
    setSending(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    cooldown.restart();
    setStatus("A new code is on its way. Use the newest email.");
  }

  const backParams = next !== "/app" ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="text-muted-foreground text-sm">
          {fromSignIn ? (
            <>
              Confirm your email address to sign in. We&apos;ve sent a new {VERIFICATION_CODE_LENGTH}-digit
              code to <span className="text-foreground font-medium break-all">{email}</span>.
            </>
          ) : (
            <>
              If <span className="text-foreground font-medium break-all">{email}</span> is new to
              SupportPilot, we&apos;ve sent it a {VERIFICATION_CODE_LENGTH}-digit code.
            </>
          )}{" "}
          It expires in {Math.round(VERIFICATION_CODE_EXPIRES_IN_SECONDS / 60)} minutes.
        </p>
      </div>
      <form method="post" onSubmit={onSubmit}>
        <div className="flex flex-col gap-4">
          <FormAlert message={error} />
          <FormAlert message={status} tone="success" />
          <FormField
            label="Verification code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern={`[0-9]{${VERIFICATION_CODE_LENGTH}}`}
            minLength={VERIFICATION_CODE_LENGTH}
            maxLength={VERIFICATION_CODE_LENGTH}
            required
            spellCheck={false}
            className="h-10 font-mono tracking-widest"
            hint={`${VERIFICATION_CODE_LENGTH} digits, from the email we just sent.`}
          />
        </div>
        <div className="mt-6 flex flex-col gap-4">
          <Button type="submit" size="lg" className="h-10 w-full" pending={pending}>
            {pending ? "Checking…" : "Verify email"}
          </Button>
          <p className="text-muted-foreground text-sm">
            No email? Check spam, or{" "}
            {cooldown.secondsLeft > 0 ? (
              <span>send a new code in {cooldown.secondsLeft} s.</span>
            ) : (
              <button type="button" className={linkClass} onClick={resend} disabled={sending}>
                {sending ? "sending…" : "send a new code"}
              </button>
            )}
          </p>
          <p className="text-muted-foreground text-sm">
            Already have an account?{" "}
            <Link href={`/sign-in${backParams}`} className={linkClass}>
              Sign in
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
