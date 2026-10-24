import { ArrowRight, ExternalLink, Inbox, PenLine, Users } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { EmptyState, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { listKbDocuments } from "@/server/modules/kb/service";
import { getTicketCounts, listTicketsForAgent } from "@/server/modules/tickets/service";
import { can } from "@/server/platform/auth/permissions";
import { Age, StatusIcon } from "./tickets/ticket-bits";
import { requireAppWorkspace } from "./workspace-context";
import { LiveRefresh } from "@/components/live-refresh";
import { newestTicketNotice } from "@/lib/live-notice";

export const metadata: Metadata = { title: "Overview" };

const requestTime = () => Date.now();
const linkClass =
  "text-primary decoration-border hover:decoration-current inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4";

export default async function OverviewPage() {
  const { ctx } = await requireAppWorkspace();
  const manage = can(ctx.role, { invitation: ["create"] });
  const writeKb = can(ctx.role, { kb: ["write"] });
  const h = await headers();
  const now = requestTime();
  const [counts, kb, recent, review] = await Promise.all([
    getTicketCounts(h),
    listKbDocuments(h),
    listTicketsForAgent(h, { status: "open,pending", limit: 5 }),
    listTicketsForAgent(h, { status: "open,pending", needsReview: "true", limit: 100 }),
  ]);
  const kbCount = (...statuses: string[]) => kb.items.filter((d) => statuses.includes(d.status)).length;
  const processing = kbCount("pending", "processing");
  const failed = kbCount("failed");
  const reviewCount = review.items.length;
  const reviewLabel = review.nextCursor ? "100+" : String(reviewCount);

  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh notice={newestTicketNotice(recent.items)} />
      <PageHeader
        title={ctx.workspace.name}
        description={
          <>
            Signed in as {ctx.user.name} · {ctx.role}
          </>
        }
        actions={
          <Link href="/app/tickets" className={buttonVariants({ variant: "outline" })}>
            <Inbox aria-hidden="true" />
            Open the inbox
          </Link>
        }
      />

      <section aria-labelledby="at-a-glance">
        <h2 id="at-a-glance" className="sr-only">
          At a glance
        </h2>
        <StatGrid>
          <Stat
            label="Open"
            value={counts.open}
            href="/app/tickets?view=open"
            srSuffix="open tickets"
            tone="brand"
          />
          <Stat
            label="Waiting for customer"
            value={counts.pending}
            href="/app/tickets?view=pending"
            srSuffix="tickets waiting for customer"
          />
          <Stat
            label="Needs review"
            value={reviewLabel}
            href="/app/tickets?needsReview=true"
            srSuffix="tickets that need review"
            tone={reviewCount > 0 ? "warning" : "neutral"}
            note="Low-confidence or sensitive triage"
          />
          <Stat
            label="Articles ready to cite"
            value={kbCount("ready")}
            href="/app/knowledge"
            srSuffix="help articles ready"
            tone={failed > 0 ? "danger" : "neutral"}
            note={
              processing || failed
                ? [processing && `${processing} processing`, failed && `${failed} failed`]
                    .filter(Boolean)
                    .join(" · ")
                : "None processing or failed"
            }
          />
        </StatGrid>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Section
          id="recent"
          title="Latest active tickets"
          description="Open or waiting, newest first."
          className="self-start lg:col-span-2"
          bodyClassName="p-0"
          actions={
            <Link href="/app/tickets" className={linkClass}>
              View all
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          }
        >
          {recent.items.length === 0 ? (
            <EmptyState icon={Inbox} title="No active tickets" className="m-4">
              New customer requests from the portal show up here.
            </EmptyState>
          ) : (
            <ul className="divide-y">
              {recent.items.map((t) => (
                <li key={t.id} className="hover:bg-muted/50 relative flex items-center gap-3 px-4 py-2.5">
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
        </Section>

        <div className="flex flex-col gap-6">
          <Section id="kb" title="Knowledge base" description="Help articles that AI drafts will cite.">
            {kb.items.length === 0 ? (
              <p className="text-muted-foreground mb-3 text-sm">
                No articles yet. Drafts can only cite what you upload.
              </p>
            ) : (
              <p className="text-muted-foreground mb-3 text-sm">
                {kb.items.length} {kb.items.length === 1 ? "document" : "documents"} uploaded.
              </p>
            )}
            <Link href="/app/knowledge" className={linkClass}>
              {kb.items.length === 0 && writeKb ? "Add your first document" : "Open the knowledge base"}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </Section>
          <Section
            id="portal"
            title="Customer portal"
            description="Share this page with your customers so they can send requests. Requests arrive in Tickets."
          >
            <Link href={`/p/${ctx.workspace.slug}`} className={`${linkClass} break-all`}>
              /p/{ctx.workspace.slug}
              <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
            </Link>
          </Section>
          <Section
            id="team"
            title="Team"
            description={
              manage ? "Invite teammates and manage their roles." : "See who is in this workspace."
            }
          >
            <Link href="/app/members" className={linkClass}>
              <Users aria-hidden="true" className="size-3.5" />
              Go to members
            </Link>
          </Section>
        </div>
      </div>
    </div>
  );
}
