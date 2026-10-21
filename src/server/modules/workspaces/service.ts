import { getAuth } from "@/server/platform/auth";
import {
  getSessionContext,
  getWorkspaceContext,
  listMemberships,
  requireWorkspace,
  type SessionContext,
  type WorkspaceContext,
} from "@/server/platform/auth/context";
import { can, isRole } from "@/server/platform/auth/permissions";
import { logger } from "@/server/platform/logger";
import * as repo from "./repository";

export type AppContext =
  | { status: "signed-out" }
  | { status: "no-workspace"; session: SessionContext }
  | {
      status: "ok";
      ctx: WorkspaceContext;
      memberships: Awaited<ReturnType<typeof listMemberships>>;
    };

/**
 * Resolves the signed-in user's active workspace for app pages. If none is active
 * (new session, or cleared by Better Auth, see AR-003) the first membership is
 * re-selected. Membership is verified against the database every time.
 */
export async function getAppContext(headers: Headers): Promise<AppContext> {
  const session = await getSessionContext(headers);
  if (!session) return { status: "signed-out" };

  let ctx = await getWorkspaceContext(headers);
  const memberships = await listMemberships(session.user.id);
  if (!ctx && memberships.length > 0) {
    try {
      await getAuth().api.setActiveOrganization({
        headers,
        body: { organizationId: memberships[0]!.workspaceId },
      });
      ctx = await getWorkspaceContext(headers);
    } catch (err) {
      logger.warn({ err: { message: (err as Error).message } }, "could not re-select active workspace");
    }
  }
  if (!ctx) return { status: "no-workspace", session };
  return { status: "ok", ctx, memberships };
}

/** All members can see who is in their workspace (needed for ticket assignment). */
export async function getMembersPage(headers: Headers) {
  const ctx = await requireWorkspace(headers);
  const canManage = can(ctx.role, { member: ["update", "delete"] });
  const canInvite = can(ctx.role, { invitation: ["create"] });
  const [members, invitations] = await Promise.all([
    repo.listMembers(ctx.workspace.id),
    canInvite ? repo.listPendingInvitations(ctx.workspace.id) : Promise.resolve([]),
  ]);
  return {
    ctx,
    canManage,
    canInvite,
    members: members.map((m) => ({ ...m, role: isRole(m.role) ? m.role : ("agent" as const) })),
    invitations,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `after` is the id of the last entry on the previous page. Malformed values are ignored. */
export async function getAuditPage(headers: Headers, after?: string) {
  const ctx = await requireWorkspace(headers, { audit: ["read"] });
  const afterId = after && UUID.test(after) ? after : undefined;
  const page = await repo.listAuditEntries(ctx.workspace.id, { limit: 50, afterId });
  return { ctx, ...page };
}
