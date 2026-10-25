/**
 * Security headers (OWASP A02 Security Misconfiguration, threat model T11 XSS).
 *
 * Strict, nonce-based Content Security Policy following the Next.js 16 CSP guide
 * (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md):
 * a fresh nonce per request, `'strict-dynamic'` so only nonce-bearing scripts (and the
 * scripts they load) run, and no `'unsafe-inline'`. Next.js reads the nonce from the
 * request's CSP header and applies it to its own scripts. This requires dynamic
 * rendering, see ADR-0011.
 *
 * `frameAncestors` defaults to 'none' (clickjacking protection). It can be set to an
 * explicit origin list (e.g. a preview host) via CSP_FRAME_ANCESTORS.
 */
const FRAME_ANCESTORS_RE =
  /^('none'|'self'|(https:\/\/[A-Za-z0-9*.-]+(:\d+)?))( ('self'|https:\/\/[A-Za-z0-9*.-]+(:\d+)?))*$/;
const NONCE_RE = /^[A-Za-z0-9+/=_-]{16,}$/;

export function normalizeFrameAncestors(value: string | undefined): string {
  const v = value?.trim();
  if (!v) return "'none'";
  // Reject anything unexpected rather than emitting a malformed/over-permissive policy.
  return FRAME_ANCESTORS_RE.test(v) ? v : "'none'";
}

/** 128 bits of randomness, base64 encoded (Web Crypto: works in the proxy runtime). */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy(opts: {
  nonce: string;
  frameAncestors?: string;
  isDevelopment: boolean;
  isProduction: boolean;
}): string {
  if (!NONCE_RE.test(opts.nonce)) throw new Error("invalid CSP nonce");
  const n = `'nonce-${opts.nonce}'`;
  const directives = [
    "default-src 'self'",
    // React needs eval in development for debugging features only (Next.js CSP guide).
    `script-src 'self' ${n} 'strict-dynamic'${opts.isDevelopment ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${n}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${normalizeFrameAncestors(opts.frameAncestors)}`,
  ];
  if (opts.isProduction) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/**
 * Paths whose URL contains a secret: the customer tracking token (plan D1) and the password
 * reset token (OWASP Forgot Password Cheat Sheet). Browsers must not leak them in the Referer
 * header to any site, including links clicked there.
 */
const SECRET_PATH_PREFIXES = ["/t/", "/api/v1/portal/t/", "/reset-password", "/api/auth/reset-password/"];

export function referrerPolicyFor(pathname: string): string {
  return SECRET_PATH_PREFIXES.some((p) => pathname.startsWith(p))
    ? "no-referrer"
    : "strict-origin-when-cross-origin";
}

export function securityHeaders(opts: {
  nonce: string;
  frameAncestors?: string;
  isDevelopment?: boolean;
  isProduction: boolean;
  /** Request path, used to pick the Referrer-Policy. */
  pathname?: string;
}): Record<string, string> {
  const frameAncestors = normalizeFrameAncestors(opts.frameAncestors);
  const headers: Record<string, string> = {
    "Content-Security-Policy": contentSecurityPolicy({
      nonce: opts.nonce,
      frameAncestors,
      isDevelopment: opts.isDevelopment ?? false,
      isProduction: opts.isProduction,
    }),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": referrerPolicyFor(opts.pathname ?? "/"),
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  if (frameAncestors === "'none'") headers["X-Frame-Options"] = "DENY";
  if (opts.isProduction) headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
  return headers;
}
