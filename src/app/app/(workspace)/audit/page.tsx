import type { Metadata } from "next";
import { TableScroll } from "@/components/table-scroll";
import { headers } from "next/headers";
import Link from "next/link";
import { Forbidden } from "@/components/forbidden";
import { requireAppWorkspace } from "../workspace-context";
import { getAuditPage } from "@/server/modules/workspaces/service";
import type { AuditAction } from "@/server/platform/auth/audit";
import { AppError } from "@/server/platform/errors";

export const metadata: Metadata = { title: "Audit log" };

const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

// Exhaustive: adding an audit action without a label fails the type check.
const LABELS: Record<AuditAction, string> = {
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
  "ticket.created": "Submitted a request",
  "ticket.status_changed": "Changed status",
  "ticket.priority_changed": "Changed priority",
  "ticket.category_changed": "Changed category",
  "ticket.assigned": "Changed assignee",
  "ticket.ai_reply_sent": "Sent an AI-drafted reply",
  "settings.updated": "Changed AI settings",
  "kb.document_uploaded": "Uploaded a knowledge document",
  "kb.document_deleted": "Deleted a knowledge document",
  "kb.document_retried": "Retried a knowledge document",
};

/** Rows store the action as text; anything unrecognised is shown as-is. */
const labelFor = (action: string) => (Object.hasOwn(LABELS, action) ? LABELS[action as AuditAction] : action);

const ACTORS: Record<string, string> = { system: "System", customer: "Customer", user: "Deleted user" };

const SETTING_FIELDS: Record<string, string> = {
  aiEnabled: "AI features",
  monthlyTokenBudget: "Monthly token budget",
  triageConfidenceThreshold: "Auto-apply threshold",
  retrievalMinScore: "Minimum match score",
  categories: "Categories",
};

const settingValue = (v: unknown) =>
  typeof v === "boolean"
    ? v
      ? "on"
      : "off"
    : typeof v === "number"
      ? v.toLocaleString("en-US")
      : String(v ?? "none");

/** "Monthly token budget: 1,000,000 → 0" for an AI settings change. */
function settingDetail(metadata: Record<string, unknown>) {
  const field = typeof metadata.field === "string" ? metadata.field : "";
  const label = Object.hasOwn(SETTING_FIELDS, field) ? SETTING_FIELDS[field] : field;
  return `${label}: ${settingValue(metadata.from)} → ${settingValue(metadata.to)}`;
}

function detail(action: string, metadata: Record<string, unknown>) {
  if (action === "settings.updated") return settingDetail(metadata);
  const s = (k: string) => (typeof metadata[k] === "string" ? (metadata[k] as string) : null);
  const number = typeof metadata.number === "number" ? `request #${metadata.number}` : null;
  const change = s("from") || s("to") ? `${s("from") ?? "none"} → ${s("to") ?? "none"}` : null;
  const role = s("role") && `role: ${s("role")}`;
  const slug = s("slug") && `address: ${s("slug")}`;
  const reason = s("reason") === "customer_reply" ? "customer replied" : null;
  const title = s("title") && `“${s("title")}”`;
  const source = s("source") === "ai_suggestion" ? "accepted AI suggestion" : null;
  return [number, title, change, role, slug, reason, source].filter(Boolean).join(" · ");
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
        <TableScroll label="Audit events">
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
                    {e.actorName ??
                      (e.metadata.source === "ai_triage" ? "AI triage" : ACTORS[e.actorType]) ??
                      "Unknown"}
                  </td>
                  <td className="px-4 py-3">
                    <div>{labelFor(e.action)}</div>
                    <div className="text-muted-foreground">{detail(e.action, e.metadata)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {page.nextCursor && (
        <Link href={`/app/audit?after=${encodeURIComponent(page.nextCursor)}`} className="text-sm underline">
          Older events
        </Link>
      )}
    </div>
  );
}
