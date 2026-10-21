import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Forbidden } from "@/components/forbidden";
import { requireAppWorkspace } from "../workspace-context";
import { getAuditPage } from "@/server/modules/workspaces/service";
import { AppError } from "@/server/platform/errors";

export const metadata: Metadata = { title: "Audit log" };

const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

const LABELS: Record<string, string> = {
  "workspace.created": "Created the workspace",
  "workspace.updated": "Updated workspace details",
  "invitation.created": "Invited a member",
  "invitation.cancelled": "Cancelled an invitation",
  "invitation.accepted": "Accepted an invitation",
  "invitation.rejected": "Declined an invitation",
  "member.added": "Added a member",
  "member.role_changed": "Changed a member's role",
  "member.removed": "Removed a member",
  "member.left": "Left the workspace",
};

function detail(metadata: Record<string, unknown>) {
  const role = typeof metadata.role === "string" ? metadata.role : null;
  const slug = typeof metadata.slug === "string" ? metadata.slug : null;
  return [role && `role: ${role}`, slug && `address: ${slug}`].filter(Boolean).join(" · ");
}

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
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground">
          Membership and workspace changes, newest first. Times are UTC.
        </p>
      </div>
      {page.entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">No events yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">Audit events</caption>
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
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
              {page.entries.map((e) => (
                <tr key={e.id} className="border-t align-top">
                  <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                    <time dateTime={e.createdAt.toISOString()}>{fmt.format(e.createdAt)}</time>
                  </td>
                  <td className="px-4 py-3">
                    {e.actorName ?? (e.actorType === "system" ? "System" : "Deleted user")}
                  </td>
                  <td className="px-4 py-3">
                    <div>{LABELS[e.action] ?? e.action}</div>
                    <div className="text-muted-foreground">{detail(e.metadata)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor && (
        <Link href={`/app/audit?after=${encodeURIComponent(page.nextCursor)}`} className="text-sm underline">
          Older events
        </Link>
      )}
    </div>
  );
}
