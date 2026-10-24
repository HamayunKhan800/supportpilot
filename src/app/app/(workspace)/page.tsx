import { ArrowRight, ExternalLink, Inbox, PenLine } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { AreaChart } from "@/components/charts/area-chart";
import { LiveRefresh } from "@/components/live-refresh";
import { EmptyState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatCount, formatDay } from "@/lib/format";
import { newestTicketNotice } from "@/lib/live-notice";
import { cn } from "@/lib/utils";
import { getUsageAnalytics } from "@/server/modules/analytics/service";
import { listKbDocuments } from "@/server/modules/kb/service";
import { getTicketCounts, listTicketsForAgent } from "@/server/modules/tickets/service";
import { getAuditPage } from "@/server/modules/workspaces/service";
import { can } from "@/server/platform/auth/permissions";
import { actorLabel, detail, iconFor, labelFor } from "./audit/describe";
import { Age, StatusIcon } from "./tickets/ticket-bits";
import { requireAppWorkspace } from "./workspace-context";

export const metadata: Metadata = { title: "Overview" };

const requestTime = () => Date.now();
const CHART_DAYS = 14;
const ACTIVITY_ITEMS = 6;
const today = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** "Sent an AI-drafted reply" → "sent an AI-drafted reply" (after the actor's name). */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const sectionTitle = "text-base font-semibold tracking-tight";
const quietLink =
  "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline";

/**
 * The workspace home (design step 10.4), laid out like Stripe's: a greeting, a "Today" band with
 * one large chart and the few numbers that need attention, then the work itself (latest active
 * tickets) beside what changed recently. Sections are separated by space and hairlines, not
 * nested cards. Every number links to the list it counts.
 */
export default async function OverviewPage() {
  const { ctx } = await requireAppWorkspace();
  const manage = can(ctx.role, { invitation: ["create"] });
  const writeKb = can(ctx.role, { kb: ["write"] });
  const readAudit = can(ctx.role, { audit: ["read"] });
  const h = await headers();
  const now = requestTime();
  const [counts, kb, recent, review, usage, activity] = await Promise.all([
    getTicketCounts(h),
    listKbDocuments(h),
    listTicketsForAgent(h, { status: "open,pending", limit: 6 }),
    listTicketsForAgent(h, { status: "open,pending", needsReview: "true", limit: 100 }),
    getUsageAnalytics(h, 30),
    readAudit ? getAuditPage(h) : null,
  ]);

  const kbCount = (...statuses: string[]) => kb.items.filter((d) => statuses.includes(d.status)).length;
  const ready = kbCount("ready");
  const processing = kbCount("pending", "processing");
  const failed = kbCount("failed");
  const reviewCount = review.items.length;
  const reviewLabel = review.nextCursor ? "100+" : String(reviewCount);

  const days = usage.tickets.daily.slice(-CHART_DAYS);
  const todayCount = days.at(-1)?.count ?? 0;
  const fortnight = days.reduce((n, d) => n + d.count, 0);
  const firstName = ctx.user.name.split(" ")[0] || ctx.user.name;

  return (
    <div data-wide className="flex flex-col gap-10">
      <LiveRefresh notice={newestTicketNotice(recent.items)} />
      <PageHeader
        title={ctx.workspace.name}
        actions={
          <Link href="/app/tickets" className={buttonVariants({ variant: "outline" })}>
            <Inbox aria-hidden="true" />
            Open the inbox
          </Link>
        }
      />

      <div className="-mt-2 flex flex-col gap-1">
        <p className="text-2xl font-semibold tracking-tight">Welcome back, {firstName}</p>
        <p className="text-muted-foreground text-sm">
          {today.format(now)} · signed in as {ctx.role}
        </p>
      </div>

      <section aria-labelledby="today-heading" className="flex flex-col gap-5">
        <h2 id="today-heading" className={sectionTitle}>
          Today
        </h2>
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 border-y py-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
              <div>
                <p className="text-muted-foreground text-sm">New requests</p>
                <p className="text-3xl font-semibold tracking-tight tabular-nums">
                  {formatCount(todayCount)}
                  <span className="text-muted-foreground ml-2 text-sm font-normal tracking-normal">
                    today
                  </span>
                </p>
              </div>
              <p className="text-muted-foreground text-sm tabular-nums">
                {formatCount(fortnight)} in the last {CHART_DAYS} days · days are UTC
              </p>
            </div>
            <AreaChart
              title="New requests per day"
              data={days.map((d) => ({ key: d.day, label: formatDay(d.day), value: d.count }))}
              valueHeader="Requests"
              unit="requests"
              className="h-44 sm:h-52"
            />
          </div>

          <dl className="flex flex-col lg:border-l lg:pl-10">
            <Figure
              label="Open"
              value={counts.open}
              href="/app/tickets?view=open"
              srSuffix="open tickets"
              note="Waiting on your team"
            />
            <Figure
              label="Waiting for customer"
              value={counts.pending}
              href="/app/tickets?view=pending"
              srSuffix="tickets waiting for customer"
              note="Back to Open when the customer replies"
            />
            <Figure
              label="Needs review"
              value={reviewLabel}
              href="/app/tickets?needsReview=true"
              srSuffix="tickets that need review"
              note="Low-confidence or sensitive triage"
              attention={reviewCount > 0}
            />
          </dl>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="recent-heading" className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <div>
              <h2 id="recent-heading" className={sectionTitle}>
                Latest active tickets
              </h2>
              <p className="text-muted-foreground text-sm">Open or waiting, newest first.</p>
            </div>
            <Link href="/app/tickets" className={quietLink}>
              View all
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>
          {recent.items.length === 0 ? (
            <EmptyState icon={Inbox} title="No active tickets">
              New customer requests from the portal show up here.
            </EmptyState>
          ) : (
            <ul className="divide-y border-y">
              {recent.items.map((t) => (
                <li key={t.id} className="hover:bg-muted/50 relative flex items-center gap-3 px-2 py-3">
                  <StatusIcon status={t.status} className="size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/app/tickets/${t.number}`}
                      className="block truncate text-sm font-medium after:absolute after:inset-0 hover:underline"
                    >
                      <span className="text-muted-foreground mr-1.5 font-normal tabular-nums">
                        #{t.number}
                      </span>
                      {t.subject}
                    </Link>
                    <p className="text-muted-foreground truncate text-xs">{t.customerName}</p>
                  </div>
                  {t.needsReview && (
                    <Badge className="bg-warning-subtle text-warning-strong h-5 shrink-0 px-1.5 text-[11px]">
                      Needs review
                    </Badge>
                  )}
                  {t.draftReady && (
                    <Badge className="bg-brand-subtle text-brand-strong h-5 shrink-0 gap-1 px-1.5 text-[11px]">
                      <PenLine aria-hidden="true" className="size-3" />
                      AI draft ready
                    </Badge>
                  )}
                  <Age date={t.createdAt} now={now} prefix="Opened" className="shrink-0 text-xs" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-10">
          {activity && (
            <section aria-labelledby="activity-heading">
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <h2 id="activity-heading" className={sectionTitle}>
                  Recent activity
                </h2>
                <Link href="/app/audit" className={quietLink}>
                  Audit log
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
              {activity.entries.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nothing has changed yet.</p>
              ) : (
                <ol className="flex flex-col">
                  {activity.entries.slice(0, ACTIVITY_ITEMS).map((e, i, all) => {
                    const Icon = iconFor(e.action);
                    const extra = detail(e.action, e.metadata);
                    return (
                      <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                        {/* The timeline's thread between the icons. */}
                        {i < all.length - 1 && (
                          <span
                            aria-hidden="true"
                            className="bg-border absolute top-6 bottom-0 left-2.5 w-px"
                          />
                        )}
                        <span className="bg-background relative flex size-5 shrink-0 items-center justify-center rounded-full border">
                          <Icon aria-hidden="true" className="text-muted-foreground size-3" />
                        </span>
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="leading-5">
                            <span className="font-medium">{actorLabel(e)}</span>{" "}
                            <span className="text-muted-foreground">{lowerFirst(labelFor(e.action))}</span>
                          </p>
                          {extra && <p className="text-muted-foreground truncate text-xs">{extra}</p>}
                        </div>
                        <Age date={e.createdAt} now={now} className="shrink-0 text-xs leading-5" />
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          )}

          <section aria-labelledby="workspace-heading">
            <h2 id="workspace-heading" className={cn(sectionTitle, "mb-3")}>
              Workspace
            </h2>
            <ul className="divide-y border-y text-sm">
              <li className="flex flex-col gap-1 py-3">
                <h3 className="font-medium">Knowledge base</h3>
                <p className="text-muted-foreground">
                  {kb.items.length === 0
                    ? "No articles yet. Drafts can only cite what you upload."
                    : `${ready} ${ready === 1 ? "article" : "articles"} ready to cite` +
                      (processing ? `, ${processing} processing` : "") +
                      (failed ? `, ${failed} failed` : "") +
                      "."}
                </p>
                <Link href="/app/knowledge" className={cn(quietLink, "text-foreground w-fit underline")}>
                  {kb.items.length === 0 && writeKb ? "Add your first document" : "Open the knowledge base"}
                </Link>
              </li>
              <li className="flex flex-col gap-1 py-3">
                <h3 className="font-medium">Customer portal</h3>
                <p className="text-muted-foreground">Customers send requests here; they arrive in Tickets.</p>
                <Link
                  href={`/p/${ctx.workspace.slug}`}
                  className={cn(quietLink, "text-foreground w-fit break-all underline")}
                >
                  /p/{ctx.workspace.slug}
                  <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                </Link>
              </li>
              <li className="flex flex-col gap-1 py-3">
                <h3 className="font-medium">Team</h3>
                <p className="text-muted-foreground">
                  {manage ? "Invite teammates and manage their roles." : "See who is in this workspace."}
                </p>
                <Link href="/app/members" className={cn(quietLink, "text-foreground w-fit underline")}>
                  Go to members
                </Link>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

/** One linked number in the Today band: label, value (the link), and one line of context. */
function Figure({
  label,
  value,
  href,
  srSuffix,
  note,
  attention = false,
}: {
  label: string;
  value: React.ReactNode;
  href: string;
  srSuffix: string;
  note: string;
  attention?: boolean;
}) {
  return (
    <div className="hover:bg-muted/40 relative -mx-2 flex flex-col gap-0.5 rounded-md px-2 py-3 first:pt-0 lg:first:pt-3">
      <dt className="text-muted-foreground flex items-center gap-2 text-sm">
        {attention && <span aria-hidden="true" className="bg-warning size-2 shrink-0 rounded-full" />}
        {label}
      </dt>
      <dd className="text-2xl font-semibold tracking-tight tabular-nums">
        <Link
          href={href}
          className="focus-visible:after:ring-ring after:absolute after:inset-0 after:rounded-md hover:underline focus-visible:outline-none focus-visible:after:ring-2"
        >
          {value}
          <span className="sr-only"> {srSuffix}</span>
        </Link>
      </dd>
      <dd className="text-muted-foreground text-xs">{note}</dd>
    </div>
  );
}
