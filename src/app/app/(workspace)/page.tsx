import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listKbDocuments } from "@/server/modules/kb/service";
import { getTicketCounts } from "@/server/modules/tickets/service";
import { can } from "@/server/platform/auth/permissions";
import { requireAppWorkspace } from "./workspace-context";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { ctx } = await requireAppWorkspace();
  const manage = can(ctx.role, { invitation: ["create"] });
  const h = await headers();
  const [counts, kb] = await Promise.all([getTicketCounts(h), listKbDocuments(h)]);
  const kbCount = (...statuses: string[]) => kb.items.filter((d) => statuses.includes(d.status)).length;
  const knowledge = [
    { label: "Ready to cite", value: kbCount("ready") },
    { label: "Processing", value: kbCount("pending", "processing") },
    { label: "Failed", value: kbCount("failed") },
  ];
  const queue = [
    { view: "open", label: "Open", value: counts.open },
    { view: "pending", label: "Waiting for customer", value: counts.pending },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{ctx.workspace.name}</h1>
        <p className="text-muted-foreground">
          Signed in as {ctx.user.name} · {ctx.role}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="sm:col-span-2">
          <CardHeader>
            <CardTitle>
              <h2>Tickets</h2>
            </CardTitle>
            <CardDescription>Requests that need attention.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-4 sm:max-w-md">
              {queue.map((q) => (
                <div key={q.view} className="flex flex-col-reverse gap-1">
                  <dt className="text-muted-foreground text-sm">{q.label}</dt>
                  <dd className="text-3xl font-semibold tabular-nums">
                    <Link href={`/app/tickets?view=${q.view}`} className="hover:underline">
                      {q.value}
                      <span className="sr-only"> {q.label.toLowerCase()} tickets</span>
                    </Link>
                  </dd>
                </div>
              ))}
            </dl>
            <Link href="/app/tickets" className="text-sm font-medium underline">
              Open the inbox
            </Link>
          </CardContent>
        </Card>
        <Card className="sm:col-span-2">
          <CardHeader>
            <CardTitle>
              <h2>Knowledge base</h2>
            </CardTitle>
            <CardDescription>Help articles that AI drafts will cite.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-3 gap-4 sm:max-w-md">
              {knowledge.map((k) => (
                <div key={k.label} className="flex flex-col-reverse gap-1">
                  <dt className="text-muted-foreground text-sm">{k.label}</dt>
                  <dd className="text-3xl font-semibold tabular-nums">{k.value}</dd>
                </div>
              ))}
            </dl>
            <Link href="/app/knowledge" className="text-sm font-medium underline">
              {kb.items.length === 0 && can(ctx.role, { kb: ["write"] })
                ? "Add your first document"
                : "Open the knowledge base"}
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Customer portal</h2>
            </CardTitle>
            <CardDescription>
              Share this page with your customers so they can send requests. Requests arrive in Tickets.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Link href={`/p/${ctx.workspace.slug}`} className="text-sm font-medium break-all underline">
              /p/{ctx.workspace.slug}
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Team</h2>
            </CardTitle>
            <CardDescription>
              {manage ? "Invite teammates and manage their roles." : "See who is in this workspace."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/app/members" className="text-sm font-medium underline">
              Go to members
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
