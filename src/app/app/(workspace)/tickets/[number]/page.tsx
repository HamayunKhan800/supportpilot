import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ZodError } from "zod";
import { LiveRefresh } from "@/components/live-refresh";
import { customerReplyNotice } from "@/lib/live-notice";
import { listInput, queueNeighbours, readQueue, ticketHref, type Queue } from "@/lib/ticket-queue";
import { cn } from "@/lib/utils";
import { getOpenDraft } from "@/server/modules/drafts/actions";
import { getTicketByNumberForAgent, listTicketsForAgent } from "@/server/modules/tickets/service";
import { can } from "@/server/platform/auth/permissions";
import { AppError } from "@/server/platform/errors";
import { requireAppWorkspace } from "../../workspace-context";
import { Composer } from "./composer";
import { DraftPanel } from "./draft-panel";
import { TicketProperties } from "./properties";
import { TicketKeys } from "./ticket-keys";
import { Conversation, QueueColumn, TicketHeader } from "./ticket-sections";
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
      <LiveRefresh key={t.id} notice={customerReplyNotice(t.customerName, messages)} />
      <TicketHeader
        t={t}
        queue={queue}
        nav={nav}
        previousHref={previousHref}
        nextHref={nextHref}
        now={d.loadedAt}
      />

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
          <Conversation messages={messages} customerName={t.customerName} />
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
            key={t.id}
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
