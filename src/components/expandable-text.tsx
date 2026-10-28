"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A long message shown clamped to 12 lines, with a button that reveals the rest. The full text is
 * always in the page (screen readers and find-in-page reach it); only the visible height changes.
 */
export function ExpandableText({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <p id={id} className={cn(className, !open && "line-clamp-12")}>
        {text}
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:text-foreground mt-2 inline-flex min-h-6 cursor-pointer items-center rounded-sm text-sm font-medium underline underline-offset-4 transition-colors"
      >
        {open ? "Show less" : "Show full message"}
      </button>
    </>
  );
}
