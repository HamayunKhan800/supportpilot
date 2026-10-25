"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import type { SocialProvider } from "@/server/platform/auth/features";

const LABELS: Record<SocialProvider, string> = { google: "Google", github: "GitHub" };

/** Google's standard "G" (its branding rules ask for the four-colour mark). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.02c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24Z"
      />
      <path fill="#FBBC05" d="M5.28 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.27a12 12 0 0 0 0 10.78l4.01-3.11Z" />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.53 11.53 0 0 0 12 0 12 12 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  );
}

/** The GitHub mark, in the text colour (GitHub allows a single-colour mark). */
function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

/**
 * "Continue with Google / GitHub", only for providers whose keys are set. Errors come back to
 * /sign-in as ?error=<code> and are shown there as fixed messages.
 */
export function SocialSignIn({ providers, next }: { providers: SocialProvider[]; next: string }) {
  const [pending, setPending] = useState<SocialProvider | null>(null);
  if (providers.length === 0) return null;

  async function start(provider: SocialProvider) {
    setPending(provider);
    const errorTo = `/sign-in${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`;
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: next,
      errorCallbackURL: errorTo,
    });
    // On success the browser is already leaving for the provider; only failures land here.
    if (error) setPending(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {providers.map((p) => (
          <Button
            key={p}
            type="button"
            variant="outline"
            size="lg"
            className="h-10 w-full gap-2"
            pending={pending === p}
            disabled={pending !== null && pending !== p}
            onClick={() => start(p)}
          >
            {p === "google" ? <GoogleMark /> : <GitHubMark />}
            Continue with {LABELS[p]}
          </Button>
        ))}
      </div>
      <div className="text-muted-foreground flex items-center gap-3 text-xs">
        <span className="bg-border h-px flex-1" aria-hidden="true" />
        <span>or</span>
        <span className="bg-border h-px flex-1" aria-hidden="true" />
      </div>
    </div>
  );
}
