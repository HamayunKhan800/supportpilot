import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/server/platform/auth/permissions";
import { requireAppWorkspace } from "./workspace-context";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { ctx } = await requireAppWorkspace();
  const manage = can(ctx.role, { invitation: ["create"] });
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{ctx.workspace.name}</h1>
        <p className="text-muted-foreground">
          Signed in as {ctx.user.name} · {ctx.role}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Ticket queue</h2>
            </CardTitle>
            <CardDescription>
              Customer tickets, replies and internal notes arrive in milestone M3.
            </CardDescription>
          </CardHeader>
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
