import { ChevronDown, ChevronUp, Lock } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ZodError } from "zod";
import { buttonVariants } from "@/components/ui/button";
import { listHref, listInput, queueNeighbours, readQueue, ticketHref, type Queue } from "@/lib/ticket-queue";
import { cn } from "@/lib/utils";
import { getOpenDraft } from "@/server/modules/drafts/actions";
import { getTicketByNumberForAgent, listTicketsForAgent } from "@/server/modules/tickets/service";
import { can } from "@/server/platform/auth/permissions";
import { AppError } from "@/server/platform/errors";
import { requireAppWorkspace } from "../../workspace-context";
import { dateFormat } from "../labels";
import { Age, Avatar, PriorityLabel, StatusIcon, StatusLabel } from "../ticket-bits";
import { Composer } from "./composer";
import { DraftPanel } from "./draft-panel";
import { TicketProperties } from "./properties";
import { TicketKeys } from "./ticket-keys";
import { TriageCard } from "./triage-card";

/** One lookup per request; 404 covers unknown numbers and other workspaces' tickets alike. */
const load = cache(async (number: string) => {
  await requireAppWorkspace();
  try {
    const h = await headers();
    const d = await getTicketByNumberForAgent(h, number);
    // A ready, unsent draft survives a reload. Closed tickets get no draft panel.
    const openDraft = d.ticket.status === "closed" ? null : await getOpenDraft(h, d.ticket.id);
    return { ...d, openDraft, loadedAt: Date.now() };
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return null;
    throw err;
  }
});

/** The list the agent came from (same filters and page), for previous / next. */
async function loadQueue(queue: Queue) {
  try {
    return await listTicketsForAgent(await headers(), listInput(queue));
  } catch (err) {
    if (err instanceof ZodError) return null; // hand-edited URL: no queue, the ticket still shows
    throw err;
  }
}

export async function generateMetadata({ params }: PageProps<"/app/tickets/[number]">): Promise<Metadata> {
  const d = await load((await params).number);
  return { title: d ? `#${d.ticket.number} ${d.ticket.subject}` : "Ticket not found" };
}

export default async function TicketPage({ params, searchParams }: PageProps<"/app/tickets/[number]">) {
  const d = await load((await params).number);
  if (!d) notFound();
  const { ticket: t, messages } = d;
  const queue = readQueue(await searchParams);
  const list = await loadQueue(queue);
  const items = list?.items ?? [];
  const nav = queueNeighbours(
    items.map((i) => i.number),
    t.number,
    Boolean(list?.nextCursor),
  );
  const previousHref = nav?.previous ? ticketHref(nav.previous, queue) : null;
  const nextHref = nav?.next ? ticketHref(nav.next, queue) : null;

  return (
    <div data-wide="xl" className="flex flex-col gap-6">
      <TicketKeys previousHref={previousHref} nextHref={nextHref} />
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <nav aria-label="Breadcrumb">
            <ol className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <li>
                <Link
                  href={listHref(queue)}
                  className="hover:text-foreground underline-offset-4 hover:underline"
                >
                  All tickets
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-foreground font-mono text-xs">
                #{t.number}
              </li>
            </ol>
          </nav>
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
        <h1 className="text-2xl font-semibold tracking-tight break-words">
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
            Opened <Age date={t.createdAt} now={d.loadedAt} />
          </span>
        </div>
      </div>

      <div
        className={cn(
          "grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]",
          items.length > 0
            ? "2xl:grid-cols-[17rem_minmax(0,1fr)_20rem]"
            : "2xl:grid-cols-[minmax(0,1fr)_20rem]",
        )}
      >
        {items.length > 0 && <QueueColumn items={items} current={t.number} queue={queue} now={d.loadedAt} />}
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="thread-heading" className="flex flex-col gap-3">
            <h2 id="thread-heading" className="text-lg font-semibold">
              Conversation
            </h2>
            <ol className="flex flex-col">
              {messages.map((m, i) => {
                const internal = m.isInternal;
                const customer = m.authorType === "customer";
                const who = customer ? t.customerName : (m.authorName ?? "Former member");
                const last = i === messages.length - 1;
                return (
                  <li key={m.id} className="relative flex gap-3 pb-5 last:pb-0">
                    {!last && (
                      <span aria-hidden="true" className="bg-border absolute top-8 bottom-0 left-3 w-px" />
                    )}
                    <Avatar
                      name={who}
                      tone={internal ? "warning" : customer ? "neutral" : "brand"}
                      className="relative mt-1"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
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
                          {dateFormat.format(m.createdAt)} UTC
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
                        <p className="break-words whitespace-pre-wrap">{m.body}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
          {t.status !== "closed" && (
            <DraftPanel
              key={t.id}
              ticketId={t.id}
              customerName={t.customerName}
              initialDraft={d.openDraft}
              canAddArticles={can(d.ctx.role, { kb: ["write"] })}
            />
          )}
          <Composer ticketId={t.id} closed={t.status === "closed"} customerName={t.customerName} />
        </div>
        <div className="flex flex-col gap-6">
          <TriageCard
            triage={d.triage}
            ticket={{ id: t.id, version: t.version, createdAt: t.createdAt }}
            threshold={d.triageThreshold}
            now={d.loadedAt}
          />
          <TicketProperties
            key={`${t.id}:${t.version}`}
            ticket={{
              id: t.id,
              version: t.version,
              status: t.status,
              priority: t.priority,
              category: t.category,
              assigneeId: t.assigneeId,
            }}
            assignees={d.assignees}
            categories={d.categories}
            currentUserId={d.ctx.user.id}
          />
        </div>
      </div>
    </div>
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

/** The list beside the ticket on very wide screens (Front / Plain style split view). */
function QueueColumn({
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
    <nav aria-label="Tickets in this list" className="hidden 2xl:block">
      <ul className="bg-card sticky top-6 max-h-[calc(100svh-3rem)] divide-y overflow-y-auto rounded-xl border">
        {items.map((i) => {
          const here = i.number === current;
          return (
            <li key={i.id}>
              <Link
                href={ticketHref(i.number, queue)}
                aria-current={here ? "page" : undefined}
                className={cn(
                  "hover:bg-muted/60 focus-visible:ring-ring flex gap-2 px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
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
