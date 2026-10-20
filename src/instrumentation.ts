/**
 * Runs once when a Next.js server instance starts (see Next.js instrumentation docs).
 * Validates configuration so a misconfigured deployment fails at boot, not on
 * the first request. Skipped during `next build`, which must not need runtime secrets.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { validateEnvironmentOrExit } = await import("./instrumentation-node");
  validateEnvironmentOrExit();
}

/** Server-side errors not caught by route wrappers (e.g. rendering errors). */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("./server/platform/logger");
  const err = error as Error & { digest?: string };
  logger.error(
    {
      err: { name: err?.name, message: err?.message, digest: err?.digest },
      method: request.method,
      // Log the route *pattern* (e.g. /t/[token]), never the concrete path:
      // paths can contain secrets such as ticket-tracking tokens.
      routePath: context.routePath,
      routeType: context.routeType,
    },
    "request error",
  );
}
