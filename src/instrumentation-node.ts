/**
 * Node.js-only startup logic, imported from instrumentation.ts when
 * NEXT_RUNTIME === "nodejs" (pattern from the Next.js instrumentation guide).
 */
import { EnvValidationError, getEnv, type Env } from "./server/platform/env";
import { setErrorReporter } from "./server/platform/error-reporting";
import { logger } from "./server/platform/logger";
import { startTracing } from "./server/platform/telemetry/setup";

export function validateEnvironmentOrExit(): Env {
  try {
    const env = getEnv();
    logger.info({ nodeEnv: env.NODE_ENV }, "environment validated");
    return env;
  } catch (err) {
    if (err instanceof EnvValidationError) {
      logger.fatal({ issues: err.issues }, "invalid environment configuration");
      // Verified behaviour (M1): throwing from register() only logs, and Next.js then
      // serves 500s on every route. Exit so the platform marks the deploy as failed.
      process.exit(1);
    }
    throw err;
  }
}

/**
 * Tracing first, then Sentry (Sentry's guide for an existing OpenTelemetry setup). Each is off
 * unless configured (plan M6 D7, D9), and Sentry's SDK is only loaded when SENTRY_DSN is set.
 */
export async function startObservability(env: Env): Promise<void> {
  const tracing = startTracing({ serviceName: "supportpilot-web", env: process.env });
  if (env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    const { buildSentryOptions, sentryReporter } = await import("./server/platform/telemetry/sentry");
    Sentry.init(
      buildSentryOptions({ ...env, SENTRY_DSN: env.SENTRY_DSN }, () => Sentry.openTelemetryIntegration()),
    );
    setErrorReporter(sentryReporter((err, hint) => Sentry.captureException(err, hint)));
  }
  logger.info(
    { tracing: tracing !== null, errorReporting: Boolean(env.SENTRY_DSN) },
    "observability configured",
  );
}
