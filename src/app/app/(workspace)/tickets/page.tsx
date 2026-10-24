import { Check, Inbox, PenLine, Search, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ZodError } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
  isFiltered,
  listHref,
  listInput,
  readQueue,
  tabFor,
  TICKET_TABS,
  ticketHref,
  type Queue,
  type TicketTab,
} from "@/lib/ticket-queue";
import { cn } from "@/lib/utils";
import { getInboxOptions, listTicketsForAgent } from "@/server/modules/tickets/service";
import { TICKET_PRIORITIES } from "@/server/modules/tickets/types";
import { requireAppWorkspace } from "../workspace-context";
import { PRIORITY_LABEL, selectClass, STATUS_LABEL } from "./labels";
import { ListKeys } from "./list-keys";
import { Age, Avatar, PriorityIcon, StatusIcon } from "./ticket-bits";
import { LiveRefresh } from "@/components/live-refresh";
import { newestTicketNotice } from "@/lib/live-notice";

export const metadata: Metadata = { title: "Tickets" };

/** One-click views over the same filters (Linear's "My issues", Plain's queues). */
const QUICK_VIEWS: { label: string; key: "assignee" | "needsReview"; value: string }[] = [
  { label: "Assigned to me", key: "assignee", value: "me" },
  { label: "Unassigned", key: "assignee", value: "unassigned" },
  { label: "Needs review", key: "needsReview", value: "true" },
];

const requestTime = () => Date.now();

export default async function TicketsPage({ searchParams }: PageProps<"/app/tickets">) {
  const { ctx } = await requireAppWorkspace();
  const queue = readQueue(await searchParams);
  const tab = tabFor(queue);
  const h = await headers();
  const now = requestTime();

  const options = await getInboxOptions(h);
  let page: Awaited<ReturnType<typeof listTicketsForAgent>> | null = null;
  let invalid = false;
  try {
    page = await listTicketsForAgent(h, listInput(queue));
  } catch (err) {
    if (!(err instanceof ZodError)) throw err;
    invalid = true; // hand-edited URL: explain instead of failing the page
  }

  const total = Object.values(options.counts).reduce((a, b) => a + b, 0);
  const tabCount = (t: TicketTab) =>
    t.statuses.length ? t.statuses.reduce((n, s) => n + options.counts[s], 0) : total;
  const filtered = isFiltered(queue);

  return (
    <div data-wide className="flex flex-col gap-5">
      <ListKeys />
      {/* A new view (other filters) starts afresh, so switching tabs never reads as news. */}
      <LiveRefresh key={JSON.stringify(queue)} notice={page ? newestTicketNotice(page.items) : null} />
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
          <p className="text-muted-foreground text-sm">Customer requests for {ctx.workspace.name}.</p>
        </div>
        <p className="text-muted-foreground hidden items-center gap-1.5 text-xs md:flex">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> to move, <Kbd>Enter</Kbd> to open
        </p>
      </div>

      <nav aria-label="Ticket status" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex min-w-max gap-1 border-b">
          {TICKET_TABS.map((t) => {
            const current = t.value === tab.value;
            return (
              <li key={t.value}>
                <Link
                  href={listHref(queue, {
                    view: t.value === "active" ? undefined : t.value,
                    after: undefined,
                  })}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "text-muted-foreground hover:text-foreground -mb-px inline-flex h-10 items-center gap-2 border-b-2 border-transparent px-3 text-sm",
                    current && "border-foreground text-foreground font-medium",
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      "bg-muted text-muted-foreground rounded px-1.5 text-xs tabular-nums",
                      current && "text-foreground",
                    )}
                  >
                    {tabCount(t)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-col gap-3">
        <nav aria-label="Quick filters">
          <ul className="flex flex-wrap gap-1.5">
            {QUICK_VIEWS.map((v) => {
              const on = queue[v.key] === v.value;
              return (
                <li key={v.label}>
                  <Link
                    href={listHref(queue, { [v.key]: on ? undefined : v.value, after: undefined })}
                    aria-current={on ? "true" : undefined}
                    className={cn(
                      "hover:bg-muted inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm",
                      on &&
                        "border-brand-border bg-brand-subtle text-brand-strong hover:bg-brand-subtle font-medium",
                    )}
                  >
                    {on && <Check aria-hidden="true" className="size-3.5" />}
                    {v.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <FilterBar
          queue={queue}
          tab={tab}
          filtered={filtered}
          options={options}
          currentUserId={ctx.user.id}
        />
      </div>

      {invalid ? (
        <p role="alert" className="border-danger-border text-danger-strong rounded-lg border p-4 text-sm">
          Some filters in the address are not valid.{" "}
          <Link href="/app/tickets" className="underline">
            Show all active tickets
          </Link>
        </p>
      ) : page && page.items.length === 0 ? (
        <EmptyState
          kind={total === 0 ? "first" : filtered ? "filtered" : "tab"}
          tab={tab}
          slug={ctx.workspace.slug}
          clearHref={listHref({ view: queue.view })}
        />
      ) : (
        page && (
          <section aria-labelledby="results-heading" className="flex flex-col gap-3">
            <h2 id="results-heading" className="sr-only">
              Results
            </h2>
            <ul className="bg-card divide-y overflow-hidden rounded-xl border">
              {page.items.map((t) => (
                <li
                  key={t.id}
                  className="enter-fade hover:bg-muted/60 has-[[data-row-link]:focus-visible]:bg-muted has-[[data-row-link]:focus-visible]:ring-ring relative grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-2.5 has-[[data-row-link]:focus-visible]:ring-2 has-[[data-row-link]:focus-visible]:ring-inset sm:items-center md:grid-cols-[1rem_3.5rem_minmax(0,1fr)_6.5rem_10rem_3.5rem]"
                >
                  <span className="pt-0.5 sm:pt-0">
                    <StatusIcon status={t.status} />
                    <span className="sr-only">{STATUS_LABEL[t.status]}</span>
                  </span>
                  <span className="text-muted-foreground hidden font-mono text-xs tabular-nums md:block">
                    #{t.number}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link
                      href={ticketHref(t.number, queue)}
                      data-row-link
                      className="truncate text-sm font-medium outline-none after:absolute after:inset-0 hover:underline"
                    >
                      <span className="text-muted-foreground mr-1.5 font-mono text-xs tabular-nums md:sr-only">
                        #{t.number}
                      </span>
                      {t.subject}
                    </Link>
                    <span className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="truncate">{t.customerName}</span>
                      {t.category && (
                        <span className="bg-muted text-foreground rounded px-1.5 py-px font-mono text-[11px]">
                          <span className="sr-only">Category: </span>
                          {t.category}
                        </span>
                      )}
                      {t.needsReview && (
                        <Badge className="bg-warning-subtle text-warning-strong h-5 px-1.5 text-[11px]">
                          Needs review
                        </Badge>
                      )}
                      {t.draftReady && (
                        <Badge className="bg-brand-subtle text-brand-strong h-5 gap-1 px-1.5 text-[11px]">
                          <PenLine aria-hidden="true" className="size-3" />
                          AI draft ready
                        </Badge>
                      )}
                      <span className="inline-flex items-center gap-1 md:hidden">
                        <PriorityIcon priority={t.priority} className="size-3.5" />
                        {PRIORITY_LABEL[t.priority]}
                      </span>
                    </span>
                  </div>
                  <span
                    className={cn(
                      "hidden items-center gap-1.5 text-xs md:inline-flex",
                      t.priority === "urgent"
                        ? "text-danger-strong font-medium"
                        : t.priority === "high"
                          ? "text-warning-strong"
                          : "text-muted-foreground",
                    )}
                  >
                    <PriorityIcon priority={t.priority} />
                    <span className="sr-only">Priority: </span>
                    {PRIORITY_LABEL[t.priority]}
                  </span>
                  <span className="text-muted-foreground hidden min-w-0 items-center gap-2 text-xs md:flex">
                    {t.assigneeName ? (
                      <>
                        <Avatar name={t.assigneeName} />
                        <span className="truncate">{t.assigneeName}</span>
                      </>
                    ) : (
                      <>
                        <span
                          aria-hidden="true"
                          className="border-border size-6 shrink-0 rounded-full border border-dashed"
                        />
                        Unassigned
                      </>
                    )}
                  </span>
                  <Age date={t.createdAt} now={now} prefix="Opened" className="text-right text-xs" />
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2 text-sm">
              {queue.after && (
                <Link
                  href={listHref(queue, { after: undefined })}
                  className={buttonVariants({ variant: "outline" })}
                >
                  First page
                </Link>
              )}
              {page.nextCursor && (
                <Link
                  href={listHref(queue, { after: page.nextCursor })}
                  className={buttonVariants({ variant: "outline" })}
                >
                  Next page
                </Link>
              )}
            </div>
          </section>
        )
      )}
    </div>
  );
}

function FilterBar({
  queue,
  tab,
  filtered,
  options,
  currentUserId,
}: {
  queue: Queue;
  tab: TicketTab;
  filtered: boolean;
  options: Awaited<ReturnType<typeof getInboxOptions>>;
  currentUserId: string;
}) {
  const compactSelect = cn(selectClass, "h-9");
  return (
    <form
      method="get"
      action="/app/tickets"
      role="search"
      aria-label="Filter tickets"
      className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:flex-wrap lg:items-center"
    >
      {tab.value !== "active" && <input type="hidden" name="view" value={tab.value} />}
      {queue.needsReview && <input type="hidden" name="needsReview" value={queue.needsReview} />}
      <div className="relative col-span-2 sm:col-span-4 lg:min-w-64 lg:flex-1">
        <label htmlFor="filter-q" className="sr-only">
          Search
        </label>
        <Search
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        />
        <Input
          id="filter-q"
          name="q"
          type="search"
          defaultValue={queue.q}
          maxLength={200}
          placeholder="Search: words, -exclude, or #12"
          className="h-9 pl-8"
        />
      </div>
      <label htmlFor="filter-priority" className="sr-only">
        Priority
      </label>
      <select
        id="filter-priority"
        name="priority"
        defaultValue={queue.priority ?? ""}
        className={cn(compactSelect, "lg:w-36")}
      >
        <option value="">Any priority</option>
        {TICKET_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]}
          </option>
        ))}
      </select>
      <label htmlFor="filter-category" className="sr-only">
        Category
      </label>
      <select
        id="filter-category"
        name="category"
        defaultValue={queue.category ?? ""}
        className={cn(compactSelect, "lg:w-40")}
      >
        <option value="">Any category</option>
        {options.categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <label htmlFor="filter-assignee" className="sr-only">
        Assignee
      </label>
      <select
        id="filter-assignee"
        name="assignee"
        defaultValue={queue.assignee ?? ""}
        className={cn(compactSelect, "lg:w-40")}
      >
        <option value="">Anyone</option>
        <option value="me">Assigned to me</option>
        <option value="unassigned">Unassigned</option>
        {options.assignees
          .filter((a) => a.id !== currentUserId)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </select>
      <label htmlFor="filter-sort" className="sr-only">
        Sort
      </label>
      <select
        id="filter-sort"
        name="sort"
        defaultValue={queue.sort ?? "newest"}
        className={cn(compactSelect, "lg:w-36")}
      >
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
      </select>
      <div className="col-span-2 flex items-center gap-3 sm:col-span-4 lg:col-span-1">
        <Button type="submit" size="lg">
          Apply filters
        </Button>
        {filtered && (
          <Link href={listHref({ view: queue.view })} className="text-muted-foreground text-sm underline">
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}

function EmptyState({
  kind,
  tab,
  slug,
  clearHref,
}: {
  kind: "first" | "filtered" | "tab";
  tab: TicketTab;
  slug: string;
  clearHref: string;
}) {
  const Icon = kind === "filtered" ? SearchX : Inbox;
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
      <span className="bg-muted text-muted-foreground inline-flex size-10 items-center justify-center rounded-full">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      {kind === "first" ? (
        <>
          <p className="font-medium">No requests yet.</p>
          <p className="text-muted-foreground max-w-sm text-sm">
            Customers write to you through your portal. Share the link, or submit a test request yourself:
          </p>
          <Link href={`/p/${slug}`} className={buttonVariants({ variant: "outline" })}>
            Open /p/{slug}
          </Link>
        </>
      ) : kind === "filtered" ? (
        <>
          <p className="font-medium">No tickets match these filters.</p>
          <Link href={clearHref} className="text-muted-foreground text-sm underline">
            Show every ticket in this tab
          </Link>
        </>
      ) : (
        <>
          <p className="font-medium">Nothing here.</p>
          <p className="text-muted-foreground text-sm">
            No {tab.value === "all" ? "" : `${tab.label.toLowerCase()} `}tickets right now.
          </p>
        </>
      )}
    </div>
  );
}
