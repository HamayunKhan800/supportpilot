import { ChevronDown, ChevronUp, Lock } from "lucide-react";
import Link from "next/link";
import { Breadcrumb } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { listHref, type Neighbours, type Queue, ticketHref } from "@/lib/ticket-queue";
import { ExpandableText } from "@/components/expandable-text";
import { isLongMessage } from "@/lib/message-length";
import { cn } from "@/lib/utils";
import type { getTicketByNumberForAgent, listTicketsForAgent } from "@/server/modules/tickets/service";
import { Age, Avatar, PriorityLabel, StatusIcon, StatusLabel } from "../ticket-bits";
import { formatDateTime } from "@/lib/format";

/** The read-only parts of the ticket page (page.tsx loads the data and lays them out). */

type TicketDetail = Awaited<ReturnType<typeof getTicketByNumberForAgent>>;
type Ticket = TicketDetail["ticket"];
type Message = TicketDetail["messages"][number];

/** Breadcrumb with previous / next in the list, the subject, and the ticket's key facts. */
export function TicketHeader({
  t,
  queue,
  nav,
  previousHref,
  nextHref,
  now,
}: {
  t: Ticket;
  queue: Queue;
  nav: Neighbours | null;
  previousHref: string | null;
  nextHref: string | null;
  now: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Breadcrumb
          parent={{ href: listHref(queue), label: "Tickets" }}
          current={<span className="font-mono text-xs">#{t.number}</span>}
        />
        {nav && (
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground mr-1 text-xs tabular-nums">
              {nav.position} of {nav.total}
              {nav.more ? "+" : ""}
              <span className="sr-only"> in this list</span>
            </span>
            <QueueStep href={previousHref} label="Previous ticket" keyName="K" icon="up" />
            <QueueStep href={nextHref} label="Next ticket" keyName="J" icon="down" />
          </div>
        )}
      </div>
      <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">
        <span className="text-muted-foreground mr-2 font-normal tabular-nums">#{t.number}</span>
        {t.subject}
      </h1>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span className="text-foreground">
          <StatusLabel status={t.status} />
        </span>
        <PriorityLabel
          priority={t.priority}
          className={t.priority === "low" || t.priority === "normal" ? "text-foreground" : undefined}
        />
        {t.category && (
          <span className="bg-muted text-foreground rounded px-1.5 py-px font-mono text-xs">
            <span className="sr-only">Category: </span>
            {t.category}
          </span>
        )}
        <span className="min-w-0 break-words">
          From <span className="text-foreground">{t.customerName}</span> &lt;{t.customerEmail}&gt;
        </span>
        <span>
          Opened <Age date={t.createdAt} now={now} />
        </span>
      </div>
    </div>
  );
}

/** The thread, oldest first: customer messages, public replies and internal notes. */
export function Conversation({
  messages,
  customerName,
}: {
  messages: readonly Message[];
  customerName: string;
}) {
  return (
    <section aria-labelledby="thread-heading" className="flex flex-col gap-3">
      <h2 id="thread-heading" className="text-lg font-semibold">
        Conversation
      </h2>
      <ol className="flex flex-col">
        {messages.map((m, i) => (
          <MessageItem key={m.id} m={m} customerName={customerName} last={i === messages.length - 1} />
        ))}
      </ol>
    </section>
  );
}

function MessageItem({ m, customerName, last }: { m: Message; customerName: string; last: boolean }) {
  const internal = m.isInternal;
  const customer = m.authorType === "customer";
  const who = customer ? customerName : (m.authorName ?? "Former member");
  return (
    <li className="enter-fade relative flex gap-3 pb-5 last:pb-0">
      {!last && <span aria-hidden="true" className="bg-border absolute top-8 bottom-0 left-3 w-px" />}
      <Avatar
        name={who}
        tone={internal ? "warning" : customer ? "neutral" : "brand"}
        className="relative mt-1"
      />
      {/* Capped at the reading measure: long emails stay near 70 characters a line. */}
      <div className="max-w-measure flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
          <span className="font-medium">
            {who}
            {internal ? (
              <span className="text-warning-strong font-semibold">
                {" "}
                · Internal note, not visible to the customer
              </span>
            ) : (
              <span className="text-muted-foreground font-normal">
                {" "}
                · {customer ? "customer" : "public reply"}
              </span>
            )}
          </span>
          <time dateTime={m.createdAt.toISOString()} className="text-muted-foreground text-xs">
            {formatDateTime(m.createdAt)}
          </time>
        </p>
        <div
          className={cn(
            "rounded-lg border px-3.5 py-3 leading-relaxed",
            internal
              ? "border-warning-border bg-warning-subtle"
              : customer
                ? "bg-card"
                : "border-brand-border bg-card",
          )}
        >
          {internal && (
            <p
              className="text-warning-strong mb-1 flex items-center gap-1.5 text-xs font-medium"
              aria-hidden="true"
            >
              <Lock className="size-3" /> Team only
            </p>
          )}
          {isLongMessage(m.body) ? (
            <ExpandableText text={m.body} className="break-words whitespace-pre-wrap" />
          ) : (
            <p className="break-words whitespace-pre-wrap">{m.body}</p>
          )}
        </div>
      </div>
    </li>
  );
}

function QueueStep({
  href,
  label,
  keyName,
  icon,
}: {
  href: string | null;
  label: string;
  keyName: string;
  icon: "up" | "down";
}) {
  const Icon = icon === "up" ? ChevronUp : ChevronDown;
  const className = cn(buttonVariants({ variant: "outline", size: "icon" }), "size-8");
  if (!href) {
    return (
      <span aria-hidden="true" className={cn(className, "pointer-events-none opacity-40")}>
        <Icon className="size-4" />
      </span>
    );
  }
  return (
    <Link href={href} className={className} aria-keyshortcuts={keyName} title={`${label} (${keyName})`}>
      <Icon aria-hidden="true" className="size-4" />
      <span className="sr-only">{label}</span>
    </Link>
  );
}

type QueueItem = Awaited<ReturnType<typeof listTicketsForAgent>>["items"][number];

/** The list beside the ticket when the page area is wide enough (Front / Intercom style split view). */
export function QueueColumn({
  items,
  current,
  queue,
  now,
}: {
  items: QueueItem[];
  current: number;
  queue: Queue;
  now: number;
}) {
  return (
    <nav aria-label="Tickets in this list" className="hidden @min-[70rem]:block">
      <ul className="bg-card sticky top-6 max-h-[calc(100svh-3rem)] divide-y overflow-y-auto rounded-xl border">
        {items.map((i) => {
          const here = i.number === current;
          return (
            <li key={i.id}>
              <Link
                href={ticketHref(i.number, queue)}
                aria-current={here ? "page" : undefined}
                className={cn(
                  "hover:bg-muted/60 active:bg-muted focus-visible:ring-ring relative flex gap-2 px-3 py-2.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
                  here && "bg-muted",
                )}
              >
                <StatusIcon status={i.status} className="mt-0.5" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("truncate", here && "font-medium")}>{i.subject}</span>
                  <span className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">
                      #{i.number} · {i.customerName}
                    </span>
                    <Age date={i.createdAt} now={now} />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
