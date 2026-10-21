"use client";

import "./globals.css";

/** Last-resort boundary when the root layout itself fails. Classes only (strict CSP). */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 font-sans">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        {error.digest && <p className="text-muted-foreground text-sm">Reference: {error.digest}</p>}
        <button type="button" onClick={reset} className="rounded-md border px-4 py-2">
          Try again
        </button>
      </body>
    </html>
  );
}
