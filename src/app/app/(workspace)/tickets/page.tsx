import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ZodError } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getInboxOptions, listTicketsForAgent } from "@/server/modules/tickets/service";
import { TICKET_PRIORITIES } from "@/server/modules/tickets/types";
import { requireAppWorkspace } from "../workspace-context";
import { dateFormat, PRIORITY_CLASS, PRIORITY_LABEL, selectClass, STATUS_LABEL } from "./labels";

export const metadata: Metadata = { title: "Tickets" };

/** Status tabs. "Active" (open + pending) is the default working view. */
const TABS = [
  { value: "active", label: "Active", statuses: ["open", "pending"] },
  { value: "open", label: "Open", statuses: ["open"] },
  { value: "pending", label: "Pending", statuses: ["pending"] },
  { value: "resolved", label: "Resolved", statuses: ["resolved"] },
  { value: "closed", label: "Closed", statuses: ["closed"] },
  { value: "all", label: "All", statuses: [] },
] as const;

const FILTER_KEYS = [
  "view",
  "q",
  "priority",
  "category",
  "assignee",
  "needsReview",
  "sort",
  "after",
] as const;
type Filters = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

function readFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const out: Filters = {};
  for (const k of FILTER_KEYS) {
    const v = Array.isArray(sp[k]) ? sp[k][0] : sp[k];
    if (v) out[k] = v;
  }
  return out;
}

function href(filters: Filters, change: Filters = {}) {
  const merged = { ...filters, ...change };
  const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as [string, string][]);
  const s = qs.toString();
  return s ? `/app/tickets?${s}` : "/app/tickets";
}

export default async function TicketsPage({ searchParams }: PageProps<"/app/tickets">) {
  const { ctx } = await requireAppWorkspace();
  const filters = readFilters(await searchParams);
  const tab = TABS.find((t) => t.value === (filters.view ?? "active")) ?? TABS[0];
  const h = await headers();

  const options = await getInboxOptions(h);
  let page: Awaited<ReturnType<typeof listTicketsForAgent>> | null = null;
  let invalid = false;
  try {
    page = await listTicketsForAgent(h, {
      status: tab.statuses.length ? tab.statuses.join(",") : undefined,
      q: filters.q,
      priority: filters.priority,
      category: filters.category,
      assignee: filters.assignee,
      needsReview: filters.needsReview,
      sort: filters.sort,
      after: filters.after,
    });
  } catch (err) {
    if (!(err instanceof ZodError)) throw err;
    invalid = true; // hand-edited URL: explain instead of failing the page
  }

  const total = Object.values(options.counts).reduce((a, b) => a + b, 0);
  const tabCount = (t: (typeof TABS)[number]) =>
    t.statuses.length ? t.statuses.reduce((n, s) => n + options.counts[s], 0) : total;
  const filtered = Boolean(
    filters.q || filters.priority || filters.category || filters.assignee || filters.needsReview,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
        <p className="text-muted-foreground">Customer requests for {ctx.workspace.name}. Times are UTC.</p>
      </div>

      <nav aria-label="Ticket status">
        <ul className="flex flex-wrap gap-1 border-b">
          {TABS.map((t) => {
            const current = t.value === tab.value;
            return (
              <li key={t.value}>
                <Link
                  href={href(filters, { view: t.value === "active" ? undefined : t.value, after: undefined })}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "hover:bg-muted -mb-px inline-flex h-10 items-center gap-2 border-b-2 border-transparent px-3 text-sm",
                    current && "border-foreground font-medium",
                  )}
                >
                  {t.label}
                  <span className="text-muted-foreground tabular-nums">{tabCount(t)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <form
        method="get"
        action="/app/tickets"
        role="search"
        aria-label="Filter tickets"
        className="grid grid-cols-2 gap-3 lg:grid-cols-6 lg:items-end"
      >
        {tab.value !== "active" && <input type="hidden" name="view" value={tab.value} />}
        <div className="col-span-2 flex flex-col gap-1.5">
          <Label htmlFor="filter-q">Search</Label>
          <Input
            id="filter-q"
            name="q"
            type="search"
            defaultValue={filters.q}
            maxLength={200}
            placeholder="Words, -exclude, or #12"
            className="h-10"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-priority">Priority</Label>
          <select
            id="filter-priority"
            name="priority"
            defaultValue={filters.priority ?? ""}
            className={selectClass}
          >
            <option value="">Any</option>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-category">Category</Label>
          <select
            id="filter-category"
            name="category"
            defaultValue={filters.category ?? ""}
            className={selectClass}
          >
            <option value="">Any</option>
            {options.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-assignee">Assignee</Label>
          <select
            id="filter-assignee"
            name="assignee"
            defaultValue={filters.assignee ?? ""}
            className={selectClass}
          >
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Unassigned</option>
            {options.assignees
              .filter((a) => a.id !== ctx.user.id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-sort">Sort</Label>
          <select
            id="filter-sort"
            name="sort"
            defaultValue={filters.sort ?? "newest"}
            className={selectClass}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-3 lg:col-span-6">
          <div className="flex items-center gap-2">
            <input
              id="filter-review"
              type="checkbox"
              name="needsReview"
              value="true"
              defaultChecked={filters.needsReview === "true"}
              className="size-4"
            />
            <Label htmlFor="filter-review">Only AI suggestions that need review</Label>
          </div>
          <Button type="submit">Apply filters</Button>
          {filtered && (
            <Link href={href({ view: filters.view })} className="text-sm underline">
              Clear filters
            </Link>
          )}
        </div>
      </form>

      {invalid ? (
        <p role="alert" className="border-danger-border text-danger-strong rounded-lg border p-4 text-sm">
          Some filters in the address are not valid.{" "}
          <Link href="/app/tickets" className="underline">
            Show all active tickets
          </Link>
        </p>
      ) : page && page.items.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border p-6 text-sm">
          {total === 0 ? (
            <>
              No requests yet. Share your customer portal:{" "}
              <Link href={`/p/${ctx.workspace.slug}`} className="text-foreground underline">
                /p/{ctx.workspace.slug}
              </Link>
            </>
          ) : (
            "No tickets match these filters."
          )}
        </div>
      ) : (
        page && (
          <section aria-labelledby="results-heading" className="flex flex-col gap-3">
            <h2 id="results-heading" className="sr-only">
              Results
            </h2>
            <ul className="divide-y rounded-lg border">
              {page.items.map((t) => (
                <li
                  key={t.id}
                  className="hover:bg-muted/40 relative flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <Link
                      href={`/app/tickets/${t.number}`}
                      className="truncate font-medium after:absolute after:inset-0 hover:underline"
                    >
                      <span className="text-muted-foreground mr-1.5 tabular-nums">#{t.number}</span>
                      {t.subject}
                    </Link>
                    <span className="text-muted-foreground truncate text-sm">
                      {t.customerName}
                      {t.category ? ` · ${t.category}` : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {t.needsReview && (
                      <Badge className="bg-warning-subtle text-warning-strong">Needs review</Badge>
                    )}
                    <Badge variant={t.status === "open" ? "default" : "secondary"}>
                      {STATUS_LABEL[t.status]}
                    </Badge>
                    <Badge variant="outline" className={PRIORITY_CLASS[t.priority]}>
                      <span className="sr-only">Priority: </span>
                      {PRIORITY_LABEL[t.priority]}
                    </Badge>
                    <span className="text-muted-foreground">{t.assigneeName ?? "Unassigned"}</span>
                    <span className="text-muted-foreground">
                      Opened{" "}
                      <time dateTime={t.createdAt.toISOString()}>{dateFormat.format(t.createdAt)}</time>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex gap-4 text-sm">
              {filters.after && (
                <Link href={href(filters, { after: undefined })} className="underline">
                  First page
                </Link>
              )}
              {page.nextCursor && (
                <Link href={href(filters, { after: page.nextCursor })} className="underline">
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
