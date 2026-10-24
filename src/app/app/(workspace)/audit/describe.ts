import {
  BookOpen,
  Building2,
  type LucideIcon,
  ScrollText,
  SlidersHorizontal,
  Ticket,
  Users,
} from "lucide-react";
import type { AuditAction } from "@/server/platform/auth/audit";

/**
 * How audit events read in the interface: the Audit log page and the Overview's recent activity
 * share these, so an event is described the same way everywhere.
 */

// Exhaustive: adding an audit action without a label fails the type check.
export const LABELS: Record<AuditAction, string> = {
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
export const labelFor = (action: string) =>
  Object.hasOwn(LABELS, action) ? LABELS[action as AuditAction] : action;

/** A small, decorative icon per kind of event, so the list scans by area at a glance. */
const AREA_ICONS: Record<string, LucideIcon> = {
  workspace: Building2,
  invitation: Users,
  member: Users,
  ticket: Ticket,
  settings: SlidersHorizontal,
  kb: BookOpen,
};
export const iconFor = (action: string) => AREA_ICONS[action.split(".")[0] ?? ""] ?? ScrollText;

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

export function detail(action: string, metadata: Record<string, unknown>) {
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

/** Who did it: the member's name, AI triage, or the kind of actor when there is no member. */
export function actorLabel(e: {
  actorName: string | null;
  actorType: string;
  metadata: Record<string, unknown>;
}) {
  return e.actorName ?? (e.metadata.source === "ai_triage" ? "AI triage" : ACTORS[e.actorType]) ?? "Unknown";
}
