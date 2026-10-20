/**
 * Baseline security headers (OWASP A02 Security Misconfiguration).
 * A full nonce-based script/style CSP is added in M2 (see docs/02-architecture.md §6).
 *
 * `frameAncestors` defaults to 'none' (clickjacking protection). It can be set to an
 * explicit origin list (e.g. a preview host) via CSP_FRAME_ANCESTORS.
 */
const FRAME_ANCESTORS_RE =
  /^('none'|'self'|(https:\/\/[A-Za-z0-9*.-]+(:\d+)?))( ('self'|https:\/\/[A-Za-z0-9*.-]+(:\d+)?))*$/;

export function normalizeFrameAncestors(value: string | undefined): string {
  const v = value?.trim();
  if (!v) return "'none'";
  // Reject anything unexpected rather than emitting a malformed/over-permissive policy.
  return FRAME_ANCESTORS_RE.test(v) ? v : "'none'";
}

export function securityHeaders(opts: {
  frameAncestors?: string;
  isProduction: boolean;
}): Record<string, string> {
  const frameAncestors = normalizeFrameAncestors(opts.frameAncestors);
  const headers: Record<string, string> = {
    "Content-Security-Policy": [
      `frame-ancestors ${frameAncestors}`,
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  if (frameAncestors === "'none'") headers["X-Frame-Options"] = "DENY";
  if (opts.isProduction) headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
  return headers;
}
