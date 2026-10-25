import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ZodError } from "zod";
import { LiveRefresh } from "@/components/live-refresh";
import { PageHeader } from "@/components/page";
import { Kbd } from "@/components/ui/kbd";
import { newestTicketNotice } from "@/lib/live-notice";
import { isFiltered, listHref, listInput, readQueue, tabFor, type TicketTab } from "@/lib/ticket-queue";
import { getInboxOptions, listTicketsForAgent } from "@/server/modules/tickets/service";
import { requireAppWorkspace } from "../workspace-context";
import { InboxFilters } from "./inbox-filters";
import { EmptyState, QuickViews, StatusTabs, TicketResults } from "./inbox-sections";
import { ListKeys } from "./list-keys";

export const metadata: Metadata = { title: "Tickets" };

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
      <PageHeader
        title="Tickets"
        description={`Customer requests for ${ctx.workspace.name}.`}
        actions={
          <p className="text-muted-foreground hidden items-center gap-1.5 text-xs md:flex">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd> to move, <Kbd>Enter</Kbd> to open
          </p>
        }
      />

      <StatusTabs queue={queue} tab={tab} tabCount={tabCount} />

      <div className="flex flex-col gap-3">
        <QuickViews queue={queue} />

        <InboxFilters
          queue={queue}
          filtered={filtered}
          categories={options.categories}
          assignees={options.assignees}
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
        page && <TicketResults page={page} queue={queue} now={now} />
      )}
    </div>
  );
}
