import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getOpenDraft } from "@/server/modules/drafts/actions";
import { getTicketByNumberForAgent } from "@/server/modules/tickets/service";
import { AppError } from "@/server/platform/errors";
import { requireAppWorkspace } from "../../workspace-context";
import { dateFormat, PRIORITY_CLASS, PRIORITY_LABEL, STATUS_LABEL } from "../labels";
import { Composer } from "./composer";
import { DraftPanel } from "./draft-panel";
import { TicketProperties } from "./properties";
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

export async function generateMetadata({ params }: PageProps<"/app/tickets/[number]">): Promise<Metadata> {
  const d = await load((await params).number);
  return { title: d ? `#${d.ticket.number} ${d.ticket.subject}` : "Ticket not found" };
}

export default async function TicketPage({ params }: PageProps<"/app/tickets/[number]">) {
  const d = await load((await params).number);
  if (!d) notFound();
  const { ticket: t, messages } = d;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/app/tickets" className="text-muted-foreground self-start text-sm underline">
          ← All tickets
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight break-words">
          <span className="text-muted-foreground mr-2 tabular-nums">#{t.number}</span>
          {t.subject}
        </h1>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Badge variant={t.status === "open" ? "default" : "secondary"}>
            <span className="sr-only">Status: </span>
            {STATUS_LABEL[t.status]}
          </Badge>
          <Badge variant="outline" className={PRIORITY_CLASS[t.priority]}>
            <span className="sr-only">Priority: </span>
            {PRIORITY_LABEL[t.priority]}
          </Badge>
          <span>
            From <span className="text-foreground">{t.customerName}</span> &lt;{t.customerEmail}&gt;
          </span>
          <span>
            Opened <time dateTime={t.createdAt.toISOString()}>{dateFormat.format(t.createdAt)} UTC</time>
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="thread-heading" className="flex flex-col gap-3">
            <h2 id="thread-heading" className="text-lg font-semibold">
              Conversation
            </h2>
            <ol className="flex flex-col gap-3">
              {messages.map((m) => {
                const internal = m.isInternal;
                const who = m.authorType === "customer" ? t.customerName : (m.authorName ?? "Former member");
                return (
                  <li key={m.id}>
                    <Card
                      className={cn(
                        internal && "border-warning-border bg-warning-subtle",
                        m.authorType === "agent" && !internal && "border-l-4 border-l-blue-700",
                      )}
                    >
                      <CardContent className="flex flex-col gap-2">
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
                                · {m.authorType === "customer" ? "customer" : "public reply"}
                              </span>
                            )}
                          </span>
                          <time dateTime={m.createdAt.toISOString()} className="text-muted-foreground">
                            {dateFormat.format(m.createdAt)} UTC
                          </time>
                        </p>
                        <p className="break-words whitespace-pre-wrap">{m.body}</p>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ol>
          </section>
          {t.status !== "closed" && (
            <DraftPanel key={t.id} ticketId={t.id} customerName={t.customerName} initialDraft={d.openDraft} />
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
