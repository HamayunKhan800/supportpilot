import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { member, organization } from "../db/schema";
import { Errors } from "../errors";
import { logger } from "../logger";
import { getAuth } from ".";
import { can, isRole, type Permission, type Role } from "./permissions";

export interface SessionContext {
  user: { id: string; name: string; email: string };
  sessionId: string;
  activeWorkspaceId: string | null;
}

export interface WorkspaceContext extends SessionContext {
  workspace: { id: string; name: string; slug: string };
  role: Role;
  memberId: string;
}

/** Validates the session cookie against the database (not just its presence). */
export async function getSessionContext(headers: Headers): Promise<SessionContext | null> {
  const result = await getAuth().api.getSession({ headers });
  if (!result) return null;
  return {
    user: { id: result.user.id, name: result.user.name, email: result.user.email },
    sessionId: result.session.id,
    activeWorkspaceId: result.session.activeOrganizationId ?? null,
  };
}

/**
 * Loads a user's membership in one workspace. Membership and role are read from the
 * database on every request, so removal or demotion takes effect immediately (T2).
 */
export async function findMembership(userId: string, workspaceId: string) {
  const { db } = getDb();
  const [row] = await db
    .select({
      memberId: member.id,
      role: member.role,
      workspaceId: organization.id,
      name: organization.name,
      slug: organization.slug,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(and(eq(member.userId, userId), eq(member.organizationId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function listMemberships(userId: string) {
  const { db } = getDb();
  return db
    .select({
      workspaceId: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(organization.name);
}

/** Session + active workspace + verified membership, or null if any part is missing. */
export async function getWorkspaceContext(headers: Headers): Promise<WorkspaceContext | null> {
  const session = await getSessionContext(headers);
  if (!session?.activeWorkspaceId) return null;
  const m = await findMembership(session.user.id, session.activeWorkspaceId);
  if (!m || !isRole(m.role)) return null;
  return {
    ...session,
    workspace: { id: m.workspaceId, name: m.name, slug: m.slug },
    role: m.role,
    memberId: m.memberId,
  };
}

/** Service-layer guard: 401 without a session, 403 without the permission. */
export async function requireWorkspace(headers: Headers, permission?: Permission): Promise<WorkspaceContext> {
  const session = await getSessionContext(headers);
  if (!session) throw Errors.unauthorized();
  const ctx = await getWorkspaceContext(headers);
  if (!ctx) {
    logAuthzDenied({ userId: session.user.id, reason: "no_workspace" });
    throw Errors.forbidden();
  }
  if (permission && !can(ctx.role, permission)) {
    logAuthzDenied({ userId: ctx.user.id, workspaceId: ctx.workspace.id, role: ctx.role, permission });
    throw Errors.forbidden();
  }
  return ctx;
}

/** Failed authorization, with who and what (M7-09, ASVS V16.3.2). IDs only, no names or emails. */
function logAuthzDenied(fields: Record<string, unknown>): void {
  logger.warn({ event: "authz.denied", ...fields }, "authorization denied");
}
