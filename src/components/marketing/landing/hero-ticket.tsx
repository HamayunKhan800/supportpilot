import { CircleCheck, Pencil, PenLine, RefreshCw, Send, X } from "lucide-react";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { Initials, PriorityBars, StatusRing } from "./mock";

/**
 * The hero picture: the real ticket screen, still, at its true size, with sample data (Taste
 * imagery.md §7: a real fragment of the interface, cropped to the part that makes the point).
 * Classes are copied from the app's own ticket page (ticket-sections.tsx, draft-panel.tsx,
 * draft-view.tsx, draft-sources.tsx), so the picture matches what a signed-in agent sees.
 *
 * It is a picture, not a demo: nothing plays, nothing is focusable, and it is hidden from screen
 * readers with a visible caption that says what it shows (the convention for every product picture
 * on this page). It replaced a self-playing demo (owner's choice, 2026-10-28).
 *
 * Cropped to the conversation, the draft and the Details card (the ticket list and the sidebar are
 * left out so the picture fits one screen). On a phone the breadcrumb and the "Conversation" label
 * are left out too; the Details card appears only when there is room beside the conversation.
 */

const CHECKS = ["Cites 2 sources", "Every citation matches a source", "No unfamiliar links"];

/** A citation marker exactly as the draft shows it (draft-sources.tsx). */
function Marker({ n }: { n: number }) {
  return (
    <span className="bg-brand-subtle text-brand-strong mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded px-1 align-[0.1em] text-xs leading-none font-semibold tabular-nums">
      {n}
    </span>
  );
}

/** A button-shaped label with the app's real button styles (a picture holds nothing to click). */
function Action({
  children,
  variant = "default",
  keyName,
  className,
}: {
  children: ReactNode;
  variant?: "default" | "outline" | "ghost";
  keyName?: string;
  className?: string;
}) {
  return (
    <span className={cn(buttonVariants({ size: "lg", variant }), className)}>
      {children}
      {keyName && (
        <Kbd
          className={cn(
            "ml-1 hidden sm:inline-flex",
            variant === "default" && "border-primary-foreground/40 text-primary-foreground bg-transparent",
          )}
        >
          {keyName}
        </Kbd>
      )}
    </span>
  );
}

export function HeroTicket() {
  return (
    <figure className="flex flex-col gap-3">
      <div aria-hidden="true" className="@container pointer-events-none select-none">
        <div
          data-ui
          className="land-shadow bg-background text-foreground grid grid-cols-1 gap-5 overflow-hidden rounded-xl border p-3 text-left sm:p-5 @min-[46rem]:grid-cols-[minmax(0,1fr)_15rem]"
        >
          <div className="flex min-w-0 flex-col gap-5">
            <TicketHeader />
            <Conversation />
            <DraftPanel />
          </div>
          <Details />
        </div>
      </div>
      <figcaption className="text-muted-foreground text-sm">
        The ticket screen, with sample data: the AI draft cites two help articles and waits for an agent to
        approve it.
      </figcaption>
    </figure>
  );
}

function TicketHeader() {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-muted-foreground hidden items-center gap-1.5 text-sm @min-[30rem]:flex">
        <span>Tickets</span>
        <span aria-hidden="true">›</span>
        <span className="text-foreground font-mono text-xs">#128</span>
        <span className="ml-auto text-xs tabular-nums">4 of 17</span>
      </div>
      <p className="text-xl font-semibold tracking-tight break-words sm:text-2xl">
        <span className="text-muted-foreground mr-2 font-normal tabular-nums">#128</span>
        Refund for my annual plan
      </p>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span className="text-foreground inline-flex items-center gap-1.5">
          <StatusRing status="open" /> Open
        </span>
        <span className="text-foreground inline-flex items-center gap-1.5">
          <PriorityBars level={2} /> Normal
        </span>
        <span className="bg-muted text-foreground rounded px-1.5 py-px font-mono text-xs">billing</span>
        <span>
          From <span className="text-foreground">Priya Shah</span>
        </span>
        <span>Opened 12m</span>
      </div>
    </div>
  );
}

function Conversation() {
  return (
    <div className="flex flex-col gap-3">
      <p className="hidden text-lg font-semibold @min-[30rem]:block">Conversation</p>
      <div className="flex gap-3">
        <Initials name="Priya Shah" className="mt-1" />
        <div className="max-w-measure flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="font-medium">
              Priya Shah <span className="text-muted-foreground font-normal">· customer</span>
            </span>
            <span className="text-muted-foreground text-xs">9:26 AM</span>
          </p>
          <p className="bg-card rounded-lg border px-3.5 py-3 leading-relaxed">
            My annual plan renewed 12 days ago and I didn&apos;t mean to keep it. Can I get my money back, and
            how long does it take?
          </p>
        </div>
      </div>
    </div>
  );
}

function DraftPanel() {
  return (
    <div className="bg-card text-card-foreground rounded-xl border">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <PenLine className="text-muted-foreground size-4 shrink-0" />
        <p className="text-sm font-semibold">AI draft</p>
        <span className="text-muted-foreground truncate font-mono text-xs">· gemini-3.8-flash</span>
      </div>
      <div className="flex flex-col gap-4 p-3 sm:p-4">
        <ul className="flex flex-wrap gap-1.5">
          {CHECKS.map((c) => (
            <li
              key={c}
              className="border-border text-muted-foreground inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs font-medium"
            >
              <CircleCheck className="text-success-strong size-3.5" />
              {c}
            </li>
          ))}
        </ul>
        <div className="bg-background flex flex-col gap-3 rounded-lg border p-3.5 leading-relaxed">
          <p>Hi Priya,</p>
          <p>
            Yes. Annual plans can be refunded in full within 30 days of purchase or renewal, so your renewal
            qualifies
            <Marker n={1} />. The refund goes back to your original payment method; your bank can take 5 to 10
            business days to show it
            <Marker n={1} />.
          </p>
          <p>
            To stop the plan renewing, go to Settings &gt; Billing and choose Cancel plan
            <Marker n={2} />.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Sources</p>
          <ol className="flex flex-col gap-2">
            {[
              { n: 1, title: "Refund policy", path: "Annual plans" },
              { n: 2, title: "Cancel your subscription", path: "Cancel your subscription" },
            ].map((s) => (
              <li key={s.n} className="flex min-h-9 items-start gap-2 rounded-lg border p-2 text-sm">
                <span className="bg-brand-subtle text-brand-strong inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-xs font-semibold tabular-nums">
                  {s.n}
                </span>
                <span className="min-w-0 flex-1 break-words">
                  {s.title} <span className="text-muted-foreground">› {s.path}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Action keyName="A">
            <Send /> Approve &amp; send
          </Action>
          <Action variant="outline" keyName="E">
            <Pencil /> Edit
          </Action>
          <Action variant="outline" keyName="R" className="hidden @min-[24rem]:inline-flex">
            <RefreshCw /> Regenerate
          </Action>
          <Action variant="ghost" className="hidden sm:ml-auto @min-[36rem]:inline-flex">
            <X /> Discard
          </Action>
        </div>
      </div>
    </div>
  );
}

function Details() {
  const rows: [string, ReactNode][] = [
    [
      "Status",
      <>
        <StatusRing status="open" /> Open
      </>,
    ],
    [
      "Priority",
      <>
        <PriorityBars level={2} /> Normal
      </>,
    ],
    ["Category", "billing"],
    ["Assignee", "Ayesha Agent"],
  ];
  return (
    <div className="bg-card hidden flex-col gap-4 self-start rounded-xl border p-4 @min-[46rem]:flex">
      <p className="font-semibold">Details</p>
      <p className="text-muted-foreground text-sm">Changes save as you make them.</p>
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-1.5">
          <p className="text-muted-foreground text-xs font-medium">{label}</p>
          <p className="inline-flex items-center gap-1.5 text-sm">{value}</p>
        </div>
      ))}
    </div>
  );
}
