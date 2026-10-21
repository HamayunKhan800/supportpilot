/**
 * Returns `target` only if it is a same-site relative path, otherwise `fallback`.
 * Prevents open redirects via ?next= (OWASP: Unvalidated Redirects and Forwards).
 */
export function safeRedirect(target: string | null | undefined, fallback = "/app"): string {
  if (!target || typeof target !== "string") return fallback;
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(target) || target.includes("\\")) return fallback;
  try {
    const url = new URL(target, "http://localhost");
    if (url.origin !== "http://localhost") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
