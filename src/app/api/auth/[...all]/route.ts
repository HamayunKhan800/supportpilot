import { getAuth } from "@/server/platform/auth";

/**
 * Better Auth endpoints (/api/auth/*): sign-up, sign-in, sign-out, sessions, workspaces,
 * invitations. Rate limiting, CSRF/origin checks and permission checks happen here, so
 * UI forms call these endpoints instead of `auth.api` (which bypasses rate limiting).
 */
export async function GET(request: Request) {
  return getAuth().handler(request);
}

export async function POST(request: Request) {
  return getAuth().handler(request);
}
