import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { haveIBeenPwned, organization } from "better-auth/plugins";
import type { Database } from "../db/client";
import * as schema from "../db/schema";
import type { Env } from "../env";
import { logger } from "../logger";
import { auditEventFromAuthResponse, memberEvent, recordAuditEvent } from "./audit";
import { ac, INVITABLE_ROLES, roles } from "./permissions";
import {
  AUTH_RATE_LIMITS,
  INVITATION_EXPIRES_IN_SECONDS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  validateWorkspaceName,
  validateWorkspaceSlug,
} from "./policy";
import { createDefaultWorkspaceSettings } from "./workspace-settings";

export type AuthEnv = Pick<
  Env,
  | "NODE_ENV"
  | "BETTER_AUTH_SECRET"
  | "BETTER_AUTH_URL"
  | "AUTH_TRUSTED_ORIGINS"
  | "AUTH_RATE_LIMIT_ENABLED"
  | "AUTH_PASSWORD_BREACH_CHECK"
  | "GITHUB_CLIENT_ID"
  | "GITHUB_CLIENT_SECRET"
>;

/**
 * Better Auth configuration (ADR-0004). Security-relevant defaults are set explicitly,
 * even where they match the library default, so the intent is reviewable:
 * docs/03-threat-model.md T1–T5, T15.
 */
export function createAuth(db: Database, env: AuthEnv) {
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
      : undefined;

  return betterAuth({
    appName: "SupportPilot",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.AUTH_TRUSTED_ORIGINS,
    telemetry: { enabled: false },
    // Route library logs into the structured JSON logger. Extra arguments are dropped
    // because they may include request data.
    logger: {
      level: "warn",
      log: (level, message) => {
        const fields = { component: "better-auth" };
        if (level === "error") logger.error(fields, message);
        else if (level === "warn") logger.warn(fields, message);
        else logger.info(fields, message);
      },
    },
    database: drizzleAdapter(db, { provider: "pg", schema }),

    emailAndPassword: {
      enabled: true,
      // No auto sign-in: sign-up returns the same response for new and existing emails
      // (account-enumeration protection, T3). Users sign in after creating an account.
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      revokeSessionsOnPasswordReset: true,
    },
    socialProviders: github ? { github } : {},

    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },

    rateLimit: {
      enabled: env.AUTH_RATE_LIMIT_ENABLED,
      // Shared across instances and restarts (memory storage is per-process).
      storage: "database",
      window: AUTH_RATE_LIMITS.global.window,
      max: AUTH_RATE_LIMITS.global.max,
      customRules: {
        "/sign-in/email": AUTH_RATE_LIMITS["/sign-in/email"],
        "/sign-up/email": AUTH_RATE_LIMITS["/sign-up/email"],
        "/change-password": AUTH_RATE_LIMITS["/change-password"],
        "/organization/invite-member": AUTH_RATE_LIMITS["/organization/invite-member"],
      },
    },

    advanced: {
      // Cookies: HttpOnly + SameSite=Lax are library defaults; Secure follows https.
      useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
      // Better Auth skips Origin/CSRF validation when it detects a test environment.
      // Force it on everywhere so tests exercise the real protection (T5).
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // A password change always signs out every other session (T4), whatever the client sends.
        if (ctx.path === "/change-password") {
          return { context: { ...ctx, body: { ...ctx.body, revokeOtherSessions: true } } };
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned;
        const failed = returned instanceof APIError;

        // Security event logging (OWASP A09). No emails or passwords in logs.
        if (ctx.path === "/sign-in/email" || ctx.path.startsWith("/callback/")) {
          if (failed) {
            logger.warn({ event: "auth.sign_in_failed", status: returned.statusCode }, "sign-in failed");
          } else if (ctx.context.newSession) {
            logger.info({ event: "auth.sign_in", userId: ctx.context.newSession.user.id }, "sign-in");
          }
          return;
        }
        if (failed) return;

        const event = auditEventFromAuthResponse(ctx.path, returned, null);
        if (!event) return;
        // The endpoint's session is not exposed to global hooks, so resolve it here
        // (only for auditable events). The actor always comes from the verified session.
        const actor = ctx.context.session ?? ctx.context.newSession ?? (await getSessionFromCtx(ctx));
        await recordAuditEvent(db, { ...event, actorUserId: actor?.user.id ?? null });
      }),
    },

    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
        allowUserToCreateOrganization: true,
        invitationExpiresIn: INVITATION_EXPIRES_IN_SECONDS,
        cancelPendingInvitationsOnReInvite: true,
        // Deletion needs a data-retention flow (tickets, KB). Deferred, so disabled for now.
        disableOrganizationDeletion: true,
        organizationHooks: {
          beforeCreateOrganization: async ({ organization: org }) => {
            const name = org.name ?? "";
            const problem = validateWorkspaceSlug(org.slug ?? "") ?? validateWorkspaceName(name);
            if (problem) throw new APIError("BAD_REQUEST", { message: problem });
            return { data: { ...org, name: name.trim() } };
          },
          afterCreateOrganization: async ({ organization: org }) => {
            await createDefaultWorkspaceSettings(db, org.id);
          },
          // addMember is a server-only endpoint without a path, so the path-based hook
          // below never sees it. It has no user session: recorded as a system action.
          afterAddMember: async ({ member: m }) => {
            // Also fired for the creator's owner membership on workspace creation, which
            // is already audited as workspace.created. Owner can't be granted any other way.
            if (m.role === "owner") return;
            const event = memberEvent("member.added", m, null);
            if (event) await recordAuditEvent(db, event);
          },
          beforeCreateInvitation: async ({ invitation }) => {
            if (!(INVITABLE_ROLES as readonly string[]).includes(invitation.role)) {
              throw new APIError("BAD_REQUEST", { message: "Invitations can grant admin or agent only." });
            }
          },
          beforeRemoveMember: async ({ member }) => {
            if (member.role.split(",").includes("owner")) {
              throw new APIError("FORBIDDEN", { message: "The workspace owner cannot be removed." });
            }
          },
          beforeUpdateMemberRole: async ({ member, newRole }) => {
            if (member.role.split(",").includes("owner")) {
              throw new APIError("FORBIDDEN", { message: "The owner's role cannot be changed." });
            }
            if (!(INVITABLE_ROLES as readonly string[]).includes(newRole)) {
              throw new APIError("BAD_REQUEST", { message: "Members can be admin or agent." });
            }
          },
        },
      }),
      ...(env.AUTH_PASSWORD_BREACH_CHECK ? [haveIBeenPwned()] : []),
      nextCookies(), // must be last (docs: integrations/next)
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
