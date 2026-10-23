import { and, desc, eq, lt } from "drizzle-orm";
import type { Database } from "../db/client";
import { auditLog } from "../db/schema";
import { logger } from "../logger";

/**
 * Workspace audit log (threat model T15; ticket events join in M3 per FR-T6). Append-only by construction: this
 * module exposes insert and list operations only, and every read is scoped by workspace.
 */
export type AuditAction =
  | "workspace.created"
  | "workspace.updated"
  | "invitation.created"
  | "invitation.cancelled"
  | "invitation.accepted"
  | "invitation.rejected"
  | "member.added"
  | "member.role_changed"
  | "member.removed"
  | "member.left"
  | "ticket.created"
  | "ticket.status_changed"
  | "ticket.priority_changed"
  | "ticket.category_changed"
  | "ticket.assigned"
  | "ticket.ai_reply_sent"
  | "kb.document_uploaded"
  | "kb.document_deleted"
  | "kb.document_retried";

export interface AuditEvent {
  workspaceId: string;
  actorUserId: string | null;
  action: AuditAction;
  targetType: "workspace" | "invitation" | "member" | "ticket" | "kb_document";
  /** Defaults to "user" when actorUserId is set, otherwise "system". */
  actorType?: "user" | "system" | "customer";
  targetId: string;
  metadata?: Record<string, string | number | boolean | null>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function memberEvent(action: AuditAction, m: unknown, actor: string | null): AuditEvent | null {
  if (!isObj(m) || !str(m.organizationId) || !str(m.id)) return null;
  return {
    workspaceId: str(m.organizationId)!,
    actorUserId: actor,
    action,
    targetType: "member",
    targetId: str(m.id)!,
    metadata: { userId: str(m.userId) ?? null, role: str(m.role) ?? null },
  };
}

function invitationEvent(action: AuditAction, inv: unknown, actor: string | null): AuditEvent | null {
  if (!isObj(inv) || !str(inv.organizationId) || !str(inv.id)) return null;
  // The invitee email is personal data; the audit log records role and status only.
  return {
    workspaceId: str(inv.organizationId)!,
    actorUserId: actor,
    action,
    targetType: "invitation",
    targetId: str(inv.id)!,
    metadata: { role: str(inv.role) ?? null },
  };
}

/** Maps a successful Better Auth organization endpoint response to an audit event. */
export function auditEventFromAuthResponse(
  path: string,
  returned: unknown,
  actorUserId: string | null,
): AuditEvent | null {
  if (!isObj(returned)) return null;
  switch (path) {
    case "/organization/create":
    case "/organization/update": {
      if (!str(returned.id)) return null;
      return {
        workspaceId: str(returned.id)!,
        actorUserId,
        action: path === "/organization/create" ? "workspace.created" : "workspace.updated",
        targetType: "workspace",
        targetId: str(returned.id)!,
        metadata: { slug: str(returned.slug) ?? null },
      };
    }
    case "/organization/invite-member":
      return invitationEvent("invitation.created", returned, actorUserId);
    case "/organization/cancel-invitation":
      return invitationEvent("invitation.cancelled", returned, actorUserId);
    case "/organization/reject-invitation":
      return invitationEvent("invitation.rejected", returned.invitation ?? returned, actorUserId);
    case "/organization/accept-invitation":
      return invitationEvent("invitation.accepted", returned.invitation, actorUserId);
    case "/organization/update-member-role":
      return memberEvent("member.role_changed", returned.member ?? returned, actorUserId);
    case "/organization/remove-member":
      return memberEvent("member.removed", returned.member, actorUserId);
    case "/organization/leave":
      return memberEvent("member.left", returned.member ?? returned, actorUserId);
    default:
      return null;
  }
}

/**
 * Records an event. A failed audit write is logged loudly but does not undo the
 * already-committed auth action (Better Auth hooks run after the change).
 */
export async function recordAuditEvent(db: Database, event: AuditEvent): Promise<void> {
  try {
    await db.insert(auditLog).values({
      workspaceId: event.workspaceId,
      actorUserId: event.actorUserId,
      actorType: actorTypeOf(event),
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      metadata: event.metadata ?? {},
    });
  } catch (err) {
    logger.error(
      {
        event: "audit.write_failed",
        action: event.action,
        workspaceId: event.workspaceId,
        err: { message: (err as Error).message },
      },
      "audit write failed",
    );
  }
}

function actorTypeOf(event: AuditEvent) {
  return event.actorType ?? (event.actorUserId ? "user" : "system");
}

/**
 * Strict variant for application changes: runs inside the caller's transaction and
 * throws on failure, so a change and its audit entry commit together or not at all
 * (FR-T6). Metadata must not contain personal data (no emails, no message text).
 */
export async function insertAuditEvent(db: Pick<Database, "insert">, event: AuditEvent): Promise<void> {
  await db.insert(auditLog).values({
    workspaceId: event.workspaceId,
    actorUserId: event.actorUserId,
    actorType: actorTypeOf(event),
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    metadata: event.metadata ?? {},
  });
}

export interface AuditPage {
  entries: (typeof auditLog.$inferSelect)[];
  nextCursor: string | null;
}

/** Newest first, keyset-paginated by created_at. Always scoped to one workspace. */
export async function listAuditEvents(
  db: Database,
  workspaceId: string,
  opts: { limit?: number; before?: Date } = {},
): Promise<AuditPage> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const rows = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.workspaceId, workspaceId),
        opts.before ? lt(auditLog.createdAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit + 1);
  const entries = rows.slice(0, limit);
  const last = entries.at(-1);
  return { entries, nextCursor: rows.length > limit && last ? last.createdAt.toISOString() : null };
}
