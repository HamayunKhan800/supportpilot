import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { emailOTP, haveIBeenPwned, organization } from "better-auth/plugins";
import { and, count, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { createEmailSender, type EmailSender, sendInBackground } from "../email";
import * as schema from "../db/schema";
import type { Env } from "../env";
import { logger } from "../logger";
import { clientIp, consumeRateLimit, rateLimitKey } from "../rate-limit";
import {
  passwordChangedEmail,
  resetPasswordEmail,
  signUpAttemptEmail,
  verificationCodeEmail,
} from "./account-emails";
import { auditEventFromAuthResponse, memberEvent, recordAuditEvent } from "./audit";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import { ac, INVITABLE_ROLES, roles } from "./permissions";
import {
  ACCOUNT_EMAIL_LIMIT,
  AUTH_RATE_LIMITS,
  MAX_OWNED_WORKSPACES,
  INVITATION_EXPIRES_IN_SECONDS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RESET_PASSWORD_EXPIRES_IN_SECONDS,
  passwordContextProblem,
  SESSION_EXPIRES_IN_SECONDS,
  VERIFICATION_CODE_ATTEMPTS,
  VERIFICATION_CODE_EXPIRES_IN_SECONDS,
  VERIFICATION_CODE_LENGTH,
  validateUserName,
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
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "EMAIL_PROVIDER"
  | "EMAIL_FROM"
  | "RESEND_API_KEY"
  | "TRUST_PROXY_HEADERS"
>;

/** Header carrying the client IP the app decided on; any copy sent by the client is dropped. */
const CLIENT_IP_HEADER = "x-sp-client-ip";

/**
 * M7-01 (T27): Better Auth reads X-Forwarded-For itself, and its rate limiter runs before any
 * plugin, so a client could pick a new "IP" per request. Every request is rewritten here to
 * carry only the IP from clientIp(), which trusts X-Forwarded-For only behind our own proxy
 * (TRUST_PROXY_HEADERS). Without it, there is no client IP and the library uses one shared bucket.
 */
export function withClientIp(req: Request, trustProxyHeaders: boolean): Request {
  const headers = new Headers(req.headers);
  headers.delete(CLIENT_IP_HEADER);
  const ip = clientIp(req.headers, trustProxyHeaders);
  if (ip !== "unknown") headers.set(CLIENT_IP_HEADER, ip);
  return new Request(req, { headers });
}

/** T18: true while this address may get another account email (reset link or code). */
async function underAccountEmailLimit(kind: string, address: string): Promise<boolean> {
  const key = rateLimitKey(`account-email-${kind}`, address.trim().toLowerCase());
  const { allowed } = await consumeRateLimit(key, ACCOUNT_EMAIL_LIMIT);
  if (!allowed) logger.warn({ event: "auth.account_email_limited", kind }, "account email limit reached");
  return allowed;
}

export interface AuthDeps {
  /** Overrides the sender chosen from the settings (tests pass an outbox). null = email off. */
  email?: EmailSender | null;
}

/**
 * Better Auth configuration (ADR-0004). Security-relevant defaults are set explicitly,
 * even where they match the library default, so the intent is reviewable:
 * docs/03-threat-model.md T1–T5, T15.
 */
export function createAuth(db: Database, env: AuthEnv, deps: AuthDeps = {}) {
  const email = deps.email === undefined ? createEmailSender(env) : deps.email;
  if (env.NODE_ENV === "production" && !env.TRUST_PROXY_HEADERS) {
    logger.warn(
      { event: "auth.no_client_ip" },
      "TRUST_PROXY_HEADERS is off: sign-in limits share one bucket for all clients (set it behind a proxy)",
    );
  }
  const signInUrl = new URL("/sign-in", env.BETTER_AUTH_URL).toString();
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
      : undefined;
  // Default scopes only (openid, email, profile): no Google app review needed for these.
  // select_account lets people with several Google accounts pick one.
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          prompt: "select_account" as const,
        }
      : undefined;

  const auth = betterAuth({
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
      // Stronger scrypt settings, versioned hashes, constant-time compare (M7-02, ./password.ts).
      password: { hash: hashPassword, verify: verifyPassword },
      revokeSessionsOnPasswordReset: true,
      // With email on, an account must confirm its address with a code before it can sign in.
      // Sign-up still answers the same for a taken email (T3); that owner gets a notice instead.
      requireEmailVerification: Boolean(email),
      ...(email && {
        onExistingUserSignUp: async ({ user }) => {
          sendInBackground(email, signUpAttemptEmail(user.email, signInUrl), "sign-up-attempt");
        },
      }),
      // Password reset by email link (OWASP Forgot Password Cheat Sheet): only when email is on.
      // The response is the same whether or not the account exists, and sending isn't awaited.
      resetPasswordTokenExpiresIn: RESET_PASSWORD_EXPIRES_IN_SECONDS,
      ...(email && {
        sendResetPassword: async ({ user, url }) => {
          if (!(await underAccountEmailLimit("reset", user.email))) return;
          sendInBackground(email, resetPasswordEmail(user.email, url), "password-reset");
        },
        onPasswordReset: async ({ user }) => {
          logger.info({ event: "auth.password_reset", userId: user.id }, "password reset");
          sendInBackground(email, passwordChangedEmail(user.email, signInUrl), "password-changed");
        },
      }),
    },
    // A code is sent on sign-up and again whenever an unverified account signs in with the right
    // password (the Email OTP plugin replaces the default link with a code). No auto sign-in.
    emailVerification: { sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: false },
    // Reset tokens and the like are stored hashed, not as plain text.
    verification: { storeIdentifier: "hashed" },
    // Endpoints this app never uses, closed so they can't be called directly: link-based
    // verification (codes replace it) and the Email OTP plugin's sign-in, reset and email change.
    disabledPaths: [
      "/send-verification-email",
      "/verify-email",
      "/sign-in/email-otp",
      "/forget-password/email-otp",
      "/email-otp/request-password-reset",
      "/email-otp/reset-password",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
      "/email-otp/check-verification-otp",
      // No screen edits a profile or renames a workspace, so these are closed too (M7-21, M7-22):
      // they accepted any name length, image URLs and workspace logo or metadata.
      "/update-user",
      "/organization/update",
    ],
    socialProviders: { ...(google && { google }), ...(github && { github }) },
    account: {
      // A Google or GitHub sign-in joins an existing account only when the provider says the email
      // is verified AND the account here has verified it too, so nobody can pre-register someone
      // else's email with a password and wait (pre-account takeover). No trustedProviders.
      accountLinking: { enabled: true, requireLocalEmailVerified: true },
      // Google/GitHub tokens are stored encrypted with the server secret (M7-07). The app never
      // calls those APIs; older plain-text tokens still read and are replaced at the next sign-in.
      encryptOAuthTokens: true,
    },

    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      // No sliding refresh: the lifetime above is absolute (M7-03).
      disableSessionRefresh: true,
    },

    rateLimit: {
      enabled: env.AUTH_RATE_LIMIT_ENABLED,
      // Shared across instances and restarts (memory storage is per-process).
      storage: "database",
      window: AUTH_RATE_LIMITS.global.window,
      max: AUTH_RATE_LIMITS.global.max,
      customRules: Object.fromEntries(Object.entries(AUTH_RATE_LIMITS).filter(([path]) => path !== "global")),
    },

    advanced: {
      // Cookies: HttpOnly + SameSite=Lax are library defaults; Secure follows https.
      useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
      // Better Auth skips Origin/CSRF validation when it detects a test environment.
      // Force it on everywhere so tests exercise the real protection (T5).
      disableOriginCheck: false,
      disableCSRFCheck: false,
      // Only the header set by withClientIp() (M7-01).
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // A password change always signs out every other session (T4), whatever the client sends.
        if (ctx.path === "/sign-up/email") {
          const problem =
            validateUserName(ctx.body?.name) ??
            passwordContextProblem(String(ctx.body?.password ?? ""), String(ctx.body?.email ?? ""));
          if (problem) throw new APIError("BAD_REQUEST", { message: problem });
        }
        if (ctx.path === "/reset-password") {
          const problem = passwordContextProblem(String(ctx.body?.newPassword ?? ""));
          if (problem) throw new APIError("BAD_REQUEST", { message: problem });
        }
        if (ctx.path === "/change-password") {
          const session = await getSessionFromCtx(ctx);
          const problem = passwordContextProblem(String(ctx.body?.newPassword ?? ""), session?.user.email);
          if (problem) throw new APIError("BAD_REQUEST", { message: problem });
          return { context: { ...ctx, body: { ...ctx.body, revokeOtherSessions: true } } };
        }
        // Codes are only for confirming an email address; other code types are turned off.
        if (ctx.path === "/email-otp/send-verification-otp" && ctx.body?.type !== "email-verification") {
          throw new APIError("BAD_REQUEST", { message: "Only email verification codes can be sent." });
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
            const userId = ctx.context.newSession.user.id;
            logger.info({ event: "auth.sign_in", userId }, "sign-in");
            // Upgrade an older password hash now that the password is known to be right (M7-02).
            const password = ctx.path === "/sign-in/email" ? ctx.body?.password : undefined;
            if (typeof password === "string") {
              const accounts = await ctx.context.internalAdapter.findAccounts(userId);
              const stored = accounts.find((a) => a.providerId === "credential")?.password;
              if (stored && needsRehash(stored)) {
                await ctx.context.internalAdapter.updatePassword(userId, await hashPassword(password));
              }
            }
          }
          return;
        }
        if (failed) return;

        // Sign-out tells the browser to drop cached pages (M7-06, ASVS V14.3.1). Only "cache":
        // local storage holds just the theme choice, and cookies are cleared by the library.
        if (ctx.path === "/sign-out") {
          ctx.setHeader("Clear-Site-Data", '"cache"');
          return;
        }

        if (ctx.path === "/email-otp/verify-email") {
          logger.info({ event: "auth.email_verified" }, "email verified");
          return;
        }

        // Tell the owner when their password changes (OWASP), reset or not.
        if (ctx.path === "/change-password" && email) {
          const changed = (returned as { user?: { email?: string } } | undefined)?.user?.email;
          if (changed) sendInBackground(email, passwordChangedEmail(changed, signInUrl), "password-changed");
          return;
        }

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
        // Owned workspaces only, so being invited to many never blocks anyone (M7-14).
        organizationLimit: async (user) => {
          const [row] = await db
            .select({ n: count() })
            .from(schema.member)
            .where(and(eq(schema.member.userId, user.id), eq(schema.member.role, "owner")));
          return (row?.n ?? 0) >= MAX_OWNED_WORKSPACES;
        },
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
      ...(email
        ? [
            emailOTP({
              overrideDefaultEmailVerification: true,
              otpLength: VERIFICATION_CODE_LENGTH,
              expiresIn: VERIFICATION_CODE_EXPIRES_IN_SECONDS,
              allowedAttempts: VERIFICATION_CODE_ATTEMPTS,
              storeOTP: "hashed",
              disableSignUp: true,
              sendVerificationOTP: async ({ email: to, otp, type }) => {
                if (type !== "email-verification") return;
                if (!(await underAccountEmailLimit("code", to))) return;
                sendInBackground(email, verificationCodeEmail(to, otp), "verification-code");
              },
            }),
          ]
        : []),
      ...(env.AUTH_PASSWORD_BREACH_CHECK ? [haveIBeenPwned()] : []),
      nextCookies(), // must be last (docs: integrations/next)
    ],
  });

  const handler = auth.handler;
  auth.handler = (req: Request) => handler(withClientIp(req, env.TRUST_PROXY_HEADERS));
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;
