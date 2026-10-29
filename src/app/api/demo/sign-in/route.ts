import { getAuth } from "@/server/platform/auth";
import { demoEmail, demoErrorFor, isSameOrigin, parseDemoRole } from "@/server/platform/auth/demo-sign-in";
import { getEnv } from "@/server/platform/env";
import { logger } from "@/server/platform/logger";

/**
 * POST /api/demo/sign-in (form field `role`): signs the visitor in as a shared demo account and
 * sends them to the app. Off unless DEMO_PASSWORD is set. Only same-origin forms are accepted.
 */
export async function POST(request: Request) {
  const env = getEnv();
  if (!env.DEMO_PASSWORD) return new Response("Not found", { status: 404 });
  if (!isSameOrigin(request.headers, env.BETTER_AUTH_URL)) {
    logger.warn({ event: "demo.sign_in_refused", reason: "origin" }, "demo sign-in refused");
    return new Response("Forbidden", { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const role = parseDemoRole(form?.get("role"));
  if (!role) return redirect(env.BETTER_AUTH_URL, "/demo?error=unavailable");

  // Through the auth handler, not auth.api, so its rate limit and hooks run (api/auth route).
  const headers = new Headers({
    "content-type": "application/json",
    origin: new URL(env.BETTER_AUTH_URL).origin,
  });
  for (const name of ["x-forwarded-for", "user-agent", "cookie"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await getAuth().handler(
    new Request(new URL("/api/auth/sign-in/email", env.BETTER_AUTH_URL), {
      method: "POST",
      headers,
      body: JSON.stringify({ email: demoEmail(role, env.DEMO_EMAIL_DOMAIN), password: env.DEMO_PASSWORD }),
    }),
  );
  if (!response.ok) {
    logger.warn({ event: "demo.sign_in_failed", status: response.status }, "demo sign-in failed");
    return redirect(env.BETTER_AUTH_URL, `/demo?error=${demoErrorFor(response.status)}`);
  }
  const done = redirect(env.BETTER_AUTH_URL, "/app");
  for (const cookie of response.headers.getSetCookie()) done.headers.append("set-cookie", cookie);
  return done;
}

function redirect(base: string, path: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location: new URL(path, base).toString(), "cache-control": "no-store" },
  });
}
