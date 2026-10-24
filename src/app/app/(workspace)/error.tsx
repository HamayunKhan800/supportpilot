"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Error boundary for workspace pages (design system step 4c). It renders inside the app
 * shell, so the sidebar stays usable, and "Try again" calls Next.js's `retry()`, which
 * re-fetches and re-renders the page (the docs prefer it to `reset()`).
 */
export default function WorkspaceError({ error, retry }: { error: unknown; retry: () => void }) {
  // Server errors arrive as an Error with a digest that matches the server logs.
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : "";
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <span className="bg-danger-subtle text-danger-strong inline-flex size-10 items-center justify-center rounded-full">
        <TriangleAlert aria-hidden="true" className="size-5" />
      </span>
      <h1 className="text-xl font-semibold tracking-tight">This page didn&apos;t load</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        Something went wrong on our side. Your data is safe; trying again usually works.
        {digest && <span className="mt-1 block">Reference: {digest}</span>}
      </p>
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        <Button size="lg" className="h-10" onClick={() => retry()}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
        <Link href="/app" className={buttonVariants({ variant: "outline", size: "lg", className: "h-10" })}>
          Go to Overview
        </Link>
      </div>
    </div>
  );
}
