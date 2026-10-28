/**
 * Auth policy constants, kept separate so they can be unit-tested and documented.
 * Sources: OWASP ASVS 5.0 V6.2 and NIST SP 800-63B-4 §3.1.1.2 (passwords), docs/01-requirements.md (FR-A2 workspaces, FR-A3 invitations).
 */
/**
 * 8 characters: the OWASP ASVS 5.0 minimum (V6.2.1, which strongly recommends 15). Chosen by the
 * owner (2026-10-28) because 15 put people off signing up. Every new password is also checked
 * against breached passwords (Have I Been Pwned, V6.2.4/V6.2.12) and product and company words
 * (V6.2.11), which blocks the common short ones. Known gap: NIST SP 800-63B-4 asks for 15 when a
 * password is the only sign-in factor, as it is here (no MFA yet).
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128; // NIST: permit at least 64

/**
 * A session ends 7 days after sign-in, however active it is (M7-03, ASVS V7.3.2): sliding
 * refresh is off, so this is an absolute lifetime. NIST SP 800-63B-4 asks AAL1 to re-authenticate
 * at least every 30 days; 7 days is stricter.
 *
 * Concurrent sessions (ASVS V7.1.2): no limit, so a phone and a laptop can both stay signed in.
 * Every session is listed on the Account page, where any or all others can be signed out (M7-05).
 */
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7; // 7 days

/** Workspaces one person may own (M7-14, T20): stops one account creating unlimited tenants. */
export const MAX_OWNED_WORKSPACES = 5;

/**
 * Account emails per address (T18): reset links and verification codes. The per-IP limits below
 * don't stop many IPs flooding one inbox. Over the limit, nothing is sent and the response is
 * unchanged, so this can't reveal whether an account exists.
 */
export const ACCOUNT_EMAIL_LIMIT = { windowSeconds: 60 * 60, max: 5 } as const;

/** Display names: 1–100 characters, no control characters (M7-22). */
export function validateUserName(name: unknown): string | null {
  if (typeof name !== "string") return "Enter your name.";
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 100) return "Name must be 1–100 characters.";
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return "Name can't contain control characters.";
  return null;
}

/**
 * Context-specific words a password must not contain (NIST SP 800-63B-4 §3.1.1.2, ASVS V6.2.11):
 * the product name and the account's email name. Breached passwords are checked separately.
 */
export function passwordContextProblem(password: string, email?: string | null): string | null {
  const squashed = password.toLowerCase().replace(/[\s._-]/g, "");
  const words = ["supportpilot"];
  const local = email
    ?.split("@")[0]
    ?.toLowerCase()
    .replace(/[\s._-]/g, "");
  if (local && local.length >= 4) words.push(local);
  if (words.some((w) => squashed.includes(w))) {
    return "Choose a password that doesn't include your email name or the product name.";
  }
  return null;
}

export const INVITATION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7; // FR-A3: 7 days

/** Password reset links work once, for 30 minutes (OWASP Forgot Password Cheat Sheet). */
export const RESET_PASSWORD_EXPIRES_IN_SECONDS = 60 * 30;
/** Email verification codes: 6 digits, 10 minutes, 3 wrong tries and the code is spent. */
export const VERIFICATION_CODE_LENGTH = 6;
export const VERIFICATION_CODE_EXPIRES_IN_SECONDS = 60 * 10;
export const VERIFICATION_CODE_ATTEMPTS = 3;
/** How long the "Send a new code" button waits between sends (matches the rate limit below). */
export const VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;

/** Sign-in/sign-up limits per IP (Better Auth's default for sign-in is 3 per 10 s). */
export const AUTH_RATE_LIMITS = {
  global: { window: 60, max: 100 },
  "/sign-in/email": { window: 60, max: 5 },
  "/sign-up/email": { window: 60, max: 3 },
  "/change-password": { window: 60, max: 5 },
  "/organization/invite-member": { window: 60, max: 10 },
  "/request-password-reset": { window: 60, max: 3 },
  "/reset-password": { window: 60, max: 5 },
  "/email-otp/send-verification-otp": { window: 60, max: 3 },
  "/email-otp/verify-email": { window: 60, max: 5 },
} as const;

/** Workspace slug: lowercase words separated by single hyphens, 3–48 chars. */
export const WORKSPACE_SLUG_RE = /^(?=.{3,48}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Slugs that would collide with routes or look official. */
export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "help",
  "invite",
  "login",
  "logout",
  "new",
  "portal",
  "settings",
  "sign-in",
  "sign-up",
  "support",
  "supportpilot",
  "www",
]);

export function validateWorkspaceSlug(slug: string): string | null {
  if (!WORKSPACE_SLUG_RE.test(slug)) {
    return "Use 3–48 lowercase letters, numbers and single hyphens (e.g. acme-support).";
  }
  if (RESERVED_SLUGS.has(slug)) return "This address is reserved. Please choose another.";
  return null;
}

export function validateWorkspaceName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return "Name must be 2–80 characters.";
  return null;
}
