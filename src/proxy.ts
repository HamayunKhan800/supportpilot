import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/server/platform/request-id";
import { createNonce, securityHeaders } from "@/server/platform/security-headers";

export const NONCE_HEADER = "x-nonce";

/** Paths that need a signed-in user. The proxy only redirects; pages re-check. */
const PROTECTED_PREFIXES = ["/app"];

/**
 * Runs before every matched request (Next.js 16 "Proxy", formerly Middleware).
 * - Assigns a request ID, forwarded to route handlers and echoed to the client.
 * - Generates a per-request CSP nonce. Next.js reads it from the request CSP header.
 * - Applies security headers.
 * - Optimistic redirect to /sign-in when no session cookie is present. This is NOT
 *   authorization (the cookie is not validated here). Every page, route and service
 *   validates the session and workspace membership itself (ADR-0007).
 */
export function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const nonce = createNonce();
  const headers = securityHeaders({
    nonce,
    frameAncestors: process.env.CSP_FRAME_ANCESTORS,
    isDevelopment: process.env.NODE_ENV === "development",
    isProduction: process.env.NODE_ENV === "production",
  });

  const { pathname, search } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  let response: NextResponse;
  if (isProtected && !getSessionCookie(request)) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", `${pathname}${search}`);
    response = NextResponse.redirect(url);
  } else {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(REQUEST_ID_HEADER, requestId);
    requestHeaders.set(NONCE_HEADER, nonce);
    requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]!);
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  response.headers.set(REQUEST_ID_HEADER, requestId);
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
