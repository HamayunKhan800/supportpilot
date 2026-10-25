import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { LiveRefresh } from "@/components/live-refresh";
import { PageHeader } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { newestTicketNotice } from "@/lib/live-notice";
import { getUsageAnalytics } from "@/server/modules/analytics/service";
import { listKbDocuments } from "@/server/modules/kb/service";
import { getTicketCounts, listTicketsForAgent } from "@/server/modules/tickets/service";
import { getAuditPage } from "@/server/modules/workspaces/service";
import { can } from "@/server/platform/auth/permissions";
import { getEnv } from "@/server/platform/env";
import { LatestTickets, RecentActivity, TodayBand, WorkspaceLinks } from "./overview-sections";
import { requireAppWorkspace } from "./workspace-context";
import { formatWeekday } from "@/lib/format";

export const metadata: Metadata = { title: "Overview" };

const requestTime = () => Date.now();

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

  const reviewCount = review.items.length;
  const reviewLabel = review.nextCursor ? "100+" : String(reviewCount);

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
          {formatWeekday(new Date(now))} · signed in as {ctx.role}
        </p>
      </div>

      <TodayBand
        daily={usage.tickets.daily}
        counts={counts}
        reviewCount={reviewCount}
        reviewLabel={reviewLabel}
      />

      <div className="grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <LatestTickets items={recent.items} now={now} />

        <div className="flex min-w-0 flex-col gap-10">
          {activity && <RecentActivity entries={activity.entries} now={now} />}
          <WorkspaceLinks
            kb={kb.items}
            slug={ctx.workspace.slug}
            portalAddress={`${new URL(getEnv().BETTER_AUTH_URL).host}/p/${ctx.workspace.slug}`}
            manage={manage}
            writeKb={writeKb}
          />
        </div>
      </div>
    </div>
  );
}
