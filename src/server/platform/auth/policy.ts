/**
 * Auth policy constants, kept separate so they can be unit-tested and documented.
 * Sources: NIST SP 800-63B-4 §3.1.1.2 (passwords), docs/01-requirements.md (FR-A2 workspaces, FR-A3 invitations).
 */
export const PASSWORD_MIN_LENGTH = 15; // single-factor passwords (no MFA yet)
export const PASSWORD_MAX_LENGTH = 128; // NIST: permit at least 64

export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7; // 7 days
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24; // sliding refresh once per day

export const INVITATION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7; // FR-A3: 7 days

/** Sign-in/sign-up limits per IP (Better Auth's default for sign-in is 3 per 10 s). */
export const AUTH_RATE_LIMITS = {
  global: { window: 60, max: 100 },
  "/sign-in/email": { window: 60, max: 5 },
  "/sign-up/email": { window: 60, max: 3 },
  "/change-password": { window: 60, max: 5 },
  "/organization/invite-member": { window: 60, max: 10 },
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
