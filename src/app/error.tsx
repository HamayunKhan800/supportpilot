"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Route error boundary. Styled with classes only: Next.js's built-in error page uses
 * inline styles, which the strict CSP blocks.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">
        An unexpected error occurred. Please try again.
        {error.digest && <span className="block text-sm">Reference: {error.digest}</span>}
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Home
        </Link>
      </div>
    </main>
  );
}
