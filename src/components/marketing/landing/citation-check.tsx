"use client";

import { FileWarning } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Cite } from "./mock";

type View = "model" | "checked";

const VIEWS: { value: View; label: string; status: string }[] = [
  {
    value: "model",
    label: "As written",
    status:
      "Showing the draft as the model wrote it. Its last sentence cites source 4, which it was never given.",
  },
  {
    value: "checked",
    label: "After the check",
    status: "Showing the draft after the check. Citation 4 is removed and the agent sees a warning.",
  },
];

/**
 * The citation guardrail, before and after (design step 9.3). The warning text is the app's own
 * (draft-labels.ts, invalid_citations). The draft itself is decorative; the switch is a pair of
 * toggle buttons, and a polite status tells screen reader users what changed.
 */
export function CitationCheck() {
  const [view, setView] = useState<View>("checked");
  const checked = view === "checked";
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div
        role="group"
        aria-label="Show the draft"
        className="bg-muted/70 flex w-fit gap-0.5 self-center rounded-lg border p-0.5 text-xs font-medium"
      >
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            aria-pressed={view === v.value}
            onClick={() => setView(v.value)}
            className={cn(
              "text-muted-foreground hover:text-foreground min-h-7 cursor-pointer rounded-md px-2.5 transition-colors",
              view === v.value && "bg-background text-foreground shadow-[0_1px_2px_oklch(0_0_0/0.08)]",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {VIEWS.find((v) => v.value === view)!.status}
      </p>
      <div
        aria-hidden="true"
        className="bg-background w-full rounded-xl border text-left text-[13px] leading-relaxed select-none"
      >
        <p className="p-4">
          Annual plans can be refunded in full within 30 days of renewal <Cite n={1} />. Refunds reach the
          original card within 5 to 10 business days <Cite n={1} />. You can also switch to monthly billing
          {checked ? (
            <span
              key="removed"
              className="border-danger-border bg-danger-subtle text-danger-strong land-pop ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded px-1 align-[1px] font-mono text-[10px] font-medium line-through"
            >
              4
            </span>
          ) : (
            <>
              {" "}
              <Cite n={4} />
            </>
          )}
          .
        </p>
        {checked ? (
          <p className="border-warning-border bg-warning-subtle text-warning-strong land-in flex items-start gap-2 border-t px-4 py-2.5 text-xs">
            <FileWarning className="mt-0.5 size-3.5 shrink-0" />
            The AI cited sources that don&apos;t exist. Those numbers were removed.
          </p>
        ) : (
          <p className="text-muted-foreground flex items-start gap-2 border-t px-4 py-2.5 text-xs">
            There is no passage 4 among those the model was given. Nothing has checked this draft yet.
          </p>
        )}
      </div>
    </div>
  );
}
