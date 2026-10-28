import { ArrowRight, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Forbidden } from "@/components/forbidden";
import { EmptyState, PageHeader } from "@/components/page";
import { TableScroll } from "@/components/table-scroll";
import { buttonVariants } from "@/components/ui/button";
import { requireAppWorkspace } from "../workspace-context";
import { getAuditPage } from "@/server/modules/workspaces/service";
import { AppError } from "@/server/platform/errors";
import { actorLabel, detail, iconFor, labelFor } from "./describe";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: PageProps<"/app/audit">) {
  const { after } = await searchParams;
  await requireAppWorkspace(); // resolve the active workspace first (shared with the layout)
  let page;
  try {
    page = await getAuditPage(await headers(), typeof after === "string" ? after : undefined);
  } catch (err) {
    if (err instanceof AppError && err.status === 403) return <Forbidden what="the audit log" />;
    throw err;
  }
  const older = typeof after === "string";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Who changed what: members, tickets, knowledge and AI settings, newest first."
      />
      {page.entries.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={older ? "No older events" : "No events yet"}
          action={
            older ? (
              <Link href="/app/audit" className={buttonVariants({ variant: "outline", size: "lg" })}>
                Back to the newest events
              </Link>
            ) : undefined
          }
        >
          {older
            ? "You have reached the start of this workspace's history."
            : "Changes to members, tickets, knowledge documents and AI settings are recorded here as they happen."}
        </EmptyState>
      ) : (
        <TableScroll label="Audit events">
          <table className="w-full text-sm">
            <caption className="sr-only">Audit events</caption>
            <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
              <tr>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
                  When
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Who
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  What
                </th>
              </tr>
            </thead>
            <tbody>
              {page.entries.map((e) => {
                const Icon = iconFor(e.action);
                const extra = detail(e.action, e.metadata);
                return (
                  <tr key={e.id} className="border-t align-top">
                    <td className="text-muted-foreground hidden px-4 py-3 whitespace-nowrap sm:table-cell">
                      <time dateTime={e.createdAt.toISOString()}>{formatDateTime(e.createdAt)}</time>
                    </td>
                    <td className="px-4 py-3">{actorLabel(e)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <Icon aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                        <div className="min-w-0">
                          <div>{labelFor(e.action)}</div>
                          {extra && <div className="text-muted-foreground break-words">{extra}</div>}
                          {/* Phones: the time moves here, so "What" keeps room to read. */}
                          <time
                            dateTime={e.createdAt.toISOString()}
                            className="text-muted-foreground mt-1 block text-xs sm:hidden"
                          >
                            {formatDateTime(e.createdAt)}
                          </time>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
      {(page.nextCursor || older) && (
        <nav aria-label="Audit log pages" className="flex flex-wrap gap-2">
          {older && page.entries.length > 0 && (
            <Link
              href="/app/audit"
              className={buttonVariants({ variant: "outline", size: "lg", className: "h-10" })}
            >
              Newest events
            </Link>
          )}
          {page.nextCursor && (
            <Link
              href={`/app/audit?after=${encodeURIComponent(page.nextCursor)}`}
              className={buttonVariants({ variant: "outline", size: "lg", className: "h-10" })}
            >
              Older events
              <ArrowRight aria-hidden="true" />
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
