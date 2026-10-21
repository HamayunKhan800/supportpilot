import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/server/platform/db/client";
import { auditLog, invitation, member, user } from "@/server/platform/db/schema";

/** Every function takes `workspaceId` and filters by it (tenant isolation, T1). */

export async function listMembers(workspaceId: string) {
  const { db } = getDb();
  return db
    .select({
      memberId: member.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, workspaceId))
    .orderBy(member.createdAt);
}

export async function listPendingInvitations(workspaceId: string, now = new Date()) {
  const { db } = getDb();
  return db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      invitedBy: user.name,
    })
    .from(invitation)
    .innerJoin(user, eq(invitation.inviterId, user.id))
    .where(
      and(
        eq(invitation.organizationId, workspaceId),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, now),
      ),
    )
    .orderBy(desc(invitation.createdAt));
}

/**
 * Keyset pagination, newest first. The cursor is the id of the last entry seen. The
 * comparison runs in SQL on (created_at, id), so microsecond timestamps and ties are
 * exact. A millisecond JS Date cursor skipped entries (found by an integration test).
 * A cursor from another workspace matches nothing, so the page is empty.
 */
export async function listAuditEntries(workspaceId: string, opts: { limit: number; afterId?: string }) {
  const { db } = getDb();
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
      actorName: user.name,
      actorType: auditLog.actorType,
    })
    .from(auditLog)
    .leftJoin(user, eq(auditLog.actorUserId, user.id))
    .where(
      and(
        eq(auditLog.workspaceId, workspaceId),
        opts.afterId
          ? sql`(${auditLog.createdAt}, ${auditLog.id}) < (select c.created_at, c.id from audit_log c where c.id = ${opts.afterId} and c.workspace_id = ${workspaceId})`
          : undefined,
      ),
    )
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(opts.limit + 1);
  const entries = rows.slice(0, opts.limit);
  const last = entries.at(-1);
  return { entries, nextCursor: rows.length > opts.limit && last ? last.id : null };
}
