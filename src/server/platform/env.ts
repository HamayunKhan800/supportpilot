import { z } from "zod";

/**
 * Server-side environment schema. Parsed lazily (first access) so that
 * `next build` does not require runtime secrets, and eagerly at server start
 * via `instrumentation.ts` so a misconfigured deployment fails fast.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z
    .url({ protocol: /^postgres(ql)?$/, error: "DATABASE_URL must be a postgres:// URL" })
    .describe("PostgreSQL connection string"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  /** Per-statement timeout so a slow query cannot pin a connection forever. */
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    // Never include values. Only variable names and reasons (values may be secrets).
    super(`Invalid environment configuration:\n  - ${issues.join("\n  - ")}`);
    this.name = "EnvValidationError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test helper: reset memoized env. */
export function resetEnvCache(): void {
  cached = undefined;
}
