import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/server/platform/request-id";
import { securityHeaders } from "@/server/platform/security-headers";

/**
 * Runs before every matched request (Next.js 16 "Proxy", formerly Middleware).
 * - Assigns a request ID, forwarded to route handlers and echoed to the client.
 * - Applies baseline security headers.
 * Not used for authorization. That is enforced in the service layer (ADR-0007).
 */
export function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  const headers = securityHeaders({
    frameAncestors: process.env.CSP_FRAME_ANCESTORS,
    isProduction: process.env.NODE_ENV === "production",
  });
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
