/**
 * Node.js-only startup logic, imported from instrumentation.ts when
 * NEXT_RUNTIME === "nodejs" (pattern from the Next.js instrumentation guide).
 */
import { EnvValidationError, getEnv } from "./server/platform/env";
import { logger } from "./server/platform/logger";

export function validateEnvironmentOrExit(): void {
  try {
    const env = getEnv();
    logger.info({ nodeEnv: env.NODE_ENV }, "environment validated");
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
