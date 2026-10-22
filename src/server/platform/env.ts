import { z } from "zod";

/**
 * Server-side environment schema. Parsed lazily (first access) so that
 * `next build` does not require runtime secrets, and eagerly at server start
 * via `instrumentation.ts` so a misconfigured deployment fails fast.
 */
const commonFields = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
};

const databaseFields = {
  DATABASE_URL: z
    .url({ protocol: /^postgres(ql)?$/, error: "DATABASE_URL must be a postgres:// URL" })
    .describe("PostgreSQL connection string"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  /** Per-statement timeout so a slow query cannot pin a connection forever. */
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
};

const aiFields = {
  /**
   * AI provider (ADR-0006). `mock` = deterministic offline embeddings for tests and local
   * work. `gemini` = Google Gemini API (needs GEMINI_API_KEY). Defaults to `mock` except in
   * production, where it must be chosen explicitly so a deployment never silently runs on
   * fake embeddings.
   */
  AI_PROVIDER: z.enum(["mock", "gemini"]).optional(),
  /** Gemini API key from Google AI Studio. Required when AI_PROVIDER=gemini. */
  GEMINI_API_KEY: z.string().min(1).optional(),
  /**
   * Most text-generation calls (triage + drafts) the whole deployment may make per day
   * (midnight-to-midnight Pacific time, when Google resets daily quotas). Shared by every
   * workspace, the web app and the worker, so a public demo can't use up the provider's free
   * daily quota (M5 D12b). 0 turns AI generation off.
   */
  AI_DAILY_CALL_LIMIT: z.coerce.number().int().min(0).max(1_000_000).default(200),
};

function refineAi(
  env: { NODE_ENV: string; AI_PROVIDER?: string; GEMINI_API_KEY?: string },
  ctx: z.RefinementCtx,
): void {
  if (env.NODE_ENV === "production" && !env.AI_PROVIDER) {
    ctx.addIssue({
      code: "custom",
      path: ["AI_PROVIDER"],
      message: "AI_PROVIDER must be set explicitly in production (gemini, or mock for test deployments)",
    });
  }
  if (env.AI_PROVIDER === "gemini" && !env.GEMINI_API_KEY) {
    ctx.addIssue({
      code: "custom",
      path: ["GEMINI_API_KEY"],
      message: "GEMINI_API_KEY is required when AI_PROVIDER=gemini",
    });
  }
}

const withAiDefault = <T extends { AI_PROVIDER?: "mock" | "gemini" }>(env: T) => ({
  ...env,
  AI_PROVIDER: env.AI_PROVIDER ?? ("mock" as const),
});

const envSchema = z
  .object({
    ...commonFields,
    ...databaseFields,

    /** Signs/encrypts sessions and tokens. Generate with `openssl rand -base64 32`. */
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    /** Public base URL of the app. Cookies are `Secure` when this is https. */
    BETTER_AUTH_URL: z.url({ protocol: /^https?$/, error: "BETTER_AUTH_URL must be an http(s) URL" }),
    /** Extra origins allowed to call auth endpoints (comma-separated, exact https origins). */
    AUTH_TRUSTED_ORIGINS: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean)
          : [],
      )
      .pipe(
        z.array(z.url({ protocol: /^https$/, error: "AUTH_TRUSTED_ORIGINS entries must be https origins" })),
      ),
    /** Rate limiting is on by default in every environment (Better Auth disables it outside production). */
    AUTH_RATE_LIMIT_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    /** Rate limits on the public portal (ticket creation, customer replies). On by default. */
    PORTAL_RATE_LIMIT_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    /**
     * Trust X-Forwarded-For for client IPs. Enable ONLY behind a proxy that overwrites the
     * header (configured at deployment, M8). When off, per-IP limits share one bucket and
     * the per-workspace limit is the backstop: a spoofable header must never be trusted.
     */
    TRUST_PROXY_HEADERS: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    /**
     * Reject passwords found in known breaches (NIST SP 800-63B-4 §3.1.1.2) via the
     * Have I Been Pwned range API (k-anonymity). Fails closed if the API is unreachable.
     */
    AUTH_PASSWORD_BREACH_CHECK: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    ...aiFields,
    /** Optional GitHub OAuth. Both values or neither. */
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.GITHUB_CLIENT_ID) !== Boolean(env.GITHUB_CLIENT_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["GITHUB_CLIENT_ID"],
        message: "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together",
      });
    }
    refineAi(env, ctx);
    // Production must use https, except loopback (CI smoke tests run the production build locally).
    const url = new URL(env.BETTER_AUTH_URL);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (env.NODE_ENV === "production" && url.protocol !== "https:" && !loopback) {
      ctx.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_URL"],
        message: "BETTER_AUTH_URL must use https in production",
      });
    }
  })
  .transform(withAiDefault);

export type Env = z.infer<typeof envSchema>;

/**
 * The background worker's settings: database, AI provider and logging only. The worker
 * never receives the web app's auth secrets (least privilege).
 */
const workerEnvSchema = z
  .object({ ...commonFields, ...databaseFields, ...aiFields })
  .superRefine(refineAi)
  .transform(withAiDefault);

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Database settings only: what the connection pool needs, in any process. */
const databaseEnvSchema = z.object(databaseFields);

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    // Never include values. Only variable names and reasons (values may be secrets).
    super(`Invalid environment configuration:\n  - ${issues.join("\n  - ")}`);
    this.name = "EnvValidationError";
  }
}

function parseWith<S extends z.ZodType>(schema: S, source: Record<string, string | undefined>): z.output<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  return result.data;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  return parseWith(envSchema, source);
}

export function parseWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  return parseWith(workerEnvSchema, source);
}

export function parseDatabaseEnv(source: Record<string, string | undefined>): DatabaseEnv {
  return parseWith(databaseEnvSchema, source);
}

let cached: Env | undefined;
let cachedWorker: WorkerEnv | undefined;
let cachedDatabase: DatabaseEnv | undefined;

/** Full web-app settings (validated eagerly at server start by instrumentation.ts). */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

export function getWorkerEnv(): WorkerEnv {
  cachedWorker ??= parseWorkerEnv(process.env);
  return cachedWorker;
}

export function getDatabaseEnv(): DatabaseEnv {
  cachedDatabase ??= parseDatabaseEnv(process.env);
  return cachedDatabase;
}

/** Test helper: reset memoized env. */
export function resetEnvCache(): void {
  cached = undefined;
  cachedWorker = undefined;
  cachedDatabase = undefined;
}
