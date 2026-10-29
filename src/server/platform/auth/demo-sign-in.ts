/**
 * One-tap sign-in to the shared demo accounts (/demo). The password is public on purpose
 * (README), but it stays on the server: the visitor only picks a role. The request goes through
 * the Better Auth handler, so the usual sign-in rate limit, security logging and session rules
 * apply exactly as for the sign-in form.
 */

export const DEMO_ROLES = ["agent", "admin", "owner"] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export function parseDemoRole(value: unknown): DemoRole | null {
  return typeof value === "string" && (DEMO_ROLES as readonly string[]).includes(value)
    ? (value as DemoRole)
    : null;
}

export function demoEmail(role: DemoRole, domain: string): string {
  return `${role}@${domain}`;
}

/**
 * Login CSRF guard (OWASP): only a form on this site may sign a browser into the demo. Browsers
 * send Origin on every cross-site POST; a missing Origin is refused too.
 */
export function isSameOrigin(headers: Headers, appUrl: string): boolean {
  const origin = headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

/** Why the demo could not open, as a fixed code for /demo?error=… (never echoed text). */
export type DemoError = "busy" | "unavailable";

export function demoErrorFor(status: number): DemoError {
  return status === 429 ? "busy" : "unavailable";
}
