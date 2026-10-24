"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export const REFRESH_INTERVAL_MS = 3000;

/**
 * Re-renders the (server-rendered) page every few seconds while documents are queued or
 * processing, and stops as soon as none are. Paused while the tab is hidden. Progress is
 * announced politely, so screen-reader users also hear when processing finishes.
 */
export function AutoRefresh({ inProgress, noun = "document" }: { inProgress: number; noun?: string }) {
  const router = useRouter();
  // "Finished" is derived when the count changes, during render (react.dev: "Adjusting
  // some state when a prop changes"), rather than in an effect.
  const [previous, setPrevious] = useState(inProgress);
  const [finished, setFinished] = useState(false);
  if (previous !== inProgress) {
    setPrevious(inProgress);
    setFinished(previous > 0 && inProgress === 0);
  }

  useEffect(() => {
    if (inProgress === 0) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [inProgress, router]);

  const text =
    inProgress > 0
      ? `Processing ${inProgress} ${noun}${inProgress === 1 ? "" : "s"}. This page updates automatically.`
      : finished
        ? "Processing finished."
        : "";

  return (
    // Takes no space while empty, but stays in the accessibility tree so later text is announced.
    <p role="status" className="text-muted-foreground text-sm empty:sr-only">
      {text}
    </p>
  );
}
