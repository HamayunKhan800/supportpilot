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

/**
 * Outbound email (docs/plans/accounts-and-email.md). Unset = no email features: no password
 * reset and no email verification, exactly as before.
 */
const emailFields = {
  /** `resend` sends real mail (needs a verified domain); `outbox` keeps it in memory (dev, tests). */
  EMAIL_PROVIDER: z.enum(["resend", "outbox"]).optional(),
  /** Sender, e.g. `SupportPilot <no-reply@example.com>`. Required when EMAIL_PROVIDER is set. */
  EMAIL_FROM: z.string().min(3).max(200).optional(),
  /** From https://resend.com/api-keys. Required when EMAIL_PROVIDER=resend. */
  RESEND_API_KEY: z.string().min(1).optional(),
  /**
   * Secret needed to read the outbox at /api/dev/email-outbox. Required when EMAIL_PROVIDER=outbox,
   * so a misconfigured server never shows reset links to anyone who asks.
   */
  EMAIL_OUTBOX_TOKEN: z.string().min(32, "EMAIL_OUTBOX_TOKEN must be at least 32 characters").optional(),
};

type EmailSettings = { [K in keyof typeof emailFields]?: string | undefined };

function refineEmail(env: EmailSettings, ctx: z.RefinementCtx): void {
  if (!env.EMAIL_PROVIDER) return;
  if (!env.EMAIL_FROM) {
    ctx.addIssue({
      code: "custom",
      path: ["EMAIL_FROM"],
      message: "EMAIL_FROM is required when EMAIL_PROVIDER is set",
    });
  }
  if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY) {
    ctx.addIssue({
      code: "custom",
      path: ["RESEND_API_KEY"],
      message: "RESEND_API_KEY is required when EMAIL_PROVIDER=resend",
    });
  }
  if (env.EMAIL_PROVIDER === "outbox" && !env.EMAIL_OUTBOX_TOKEN) {
    ctx.addIssue({
      code: "custom",
      path: ["EMAIL_OUTBOX_TOKEN"],
      message: "EMAIL_OUTBOX_TOKEN is required when EMAIL_PROVIDER=outbox",
    });
  }
}

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
  /**
   * Most texts the whole deployment may send to Gemini for embedding per Pacific-time day
   * (uploads count one per chunk, every search and draft one). The free tier allowed 1,000
   * per project per day when planned (plan M4 finding #70; check the project's limits in AI
   * Studio), so the default leaves room. Gemini only; the offline mock is never capped.
   */
  AI_DAILY_EMBEDDING_LIMIT: z.coerce.number().int().min(0).max(10_000_000).default(800),
};

/** Treats `VAR=` (empty) as unset, so a template with blank optional entries still validates. */
const emptyAsUnset = (value: unknown) => (value === "" ? undefined : value);

const observabilityFields = {
  /**
   * OpenTelemetry tracing (plan M6 D7, ADR-0018): off unless one of these OTLP/HTTP endpoints is
   * set, e.g. http://localhost:4318 for a local Jaeger. The exporter also reads the standard
   * OTEL_EXPORTER_OTLP_HEADERS for a backend that needs a key.
   */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(
    emptyAsUnset,
    z.url({ protocol: /^https?$/, error: "OTEL_EXPORTER_OTLP_ENDPOINT must be an http(s) URL" }).optional(),
  ),
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.preprocess(
    emptyAsUnset,
    z
      .url({ protocol: /^https?$/, error: "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must be an http(s) URL" })
      .optional(),
  ),
  /** Sentry error reporting (plan M6 D9): off unless set. The project's DSN from sentry.io. */
  SENTRY_DSN: z.preprocess(
    emptyAsUnset,
    z.url({ protocol: /^https$/, error: "SENTRY_DSN must be an https:// DSN from sentry.io" }).optional(),
  ),
  /** Shown on each Sentry event; defaults to NODE_ENV. */
  SENTRY_ENVIRONMENT: z.preprocess(
    emptyAsUnset,
    z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,64}$/, "SENTRY_ENVIRONMENT may use letters, digits, . _ - (max 64)")
      .optional(),
  ),
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
    ...observabilityFields,

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
     * header (configured at deployment, M8). Used by the portal and the auth library (M7-01).
     * When off, per-IP limits share one bucket and
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
    /**
     * Who may use the evaluation Review page (M6 D2): a comma-separated list of email
     * addresses. Empty (the default) turns the page and its API off for everyone. For the
     * project owner's local review only; leave it unset on public deployments.
     */
    EVAL_REVIEWER_EMAILS: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v
              .split(",")
              .map((e) => e.trim().toLowerCase())
              .filter(Boolean)
          : [],
      )
      .pipe(z.array(z.email({ error: "EVAL_REVIEWER_EMAILS entries must be email addresses" })).max(10)),
    /**
     * Email domain of the shared demo accounts (scripts/seed-demo.ts). Accounts on it can't
     * change their password, sessions, linked sign-ins or members, and are never emailed
     * (auth/demo.ts, plan M8 step 2). Deployments set a subdomain of their own domain.
     */
    DEMO_EMAIL_DOMAIN: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, {
        error: "DEMO_EMAIL_DOMAIN must be a domain name such as demo.example.com",
      })
      .default("demo.supportpilot.dev"),
    /** Optional GitHub sign-in. Both values or neither. */
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    /** Optional Google sign-in. Both values or neither. */
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    ...emailFields,
  })
  .superRefine((env, ctx) => {
    for (const [id, secret] of [
      ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    ] as const) {
      if (Boolean(env[id]) !== Boolean(env[secret])) {
        ctx.addIssue({ code: "custom", path: [id], message: `${id} and ${secret} must be set together` });
      }
    }
    refineEmail(env, ctx);
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
  .object({
    ...commonFields,
    ...databaseFields,
    ...aiFields,
    ...observabilityFields,
    /**
     * How long running jobs may finish after a stop signal (unfinished ones are retried).
     * Keep it below the host's shutdown deadline: Cloud Run allows 10 seconds, and the
     * container launcher (scripts/start-container.ts) stops waiting at 9 (plan M8 D2).
     */
    WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    /**
     * Drain mode (plan M8 revision 2, R4): when set, the worker exits once the queues are
     * empty, and stops taking jobs at this time (epoch milliseconds) at the latest. Set by
     * the worker Lambda function's launcher; unset = run until stopped, as before.
     */
    WORKER_DRAIN_DEADLINE: z.preprocess(emptyAsUnset, z.coerce.number().int().positive().optional()),
    /** Drain mode: how long the queues must stay empty before the worker exits. */
    WORKER_DRAIN_IDLE_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  })
  .superRefine(refineAi)
  .transform(withAiDefault);

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/**
 * Waking the worker after a job is queued (plan M8 revision 2, R4; jobs/wake.ts). Unset =
 * never: the worker runs on its own, as locally and in CI.
 */
const wakeEnvSchema = z.object({
  /** The worker Lambda function to invoke, e.g. supportpilot-worker:live (name, alias or ARN). */
  WORKER_FUNCTION_NAME: z.preprocess(
    emptyAsUnset,
    z
      .string()
      .regex(/^[A-Za-z0-9_:.-]{1,170}$/, "WORKER_FUNCTION_NAME must be a Lambda function name, alias or ARN")
      .optional(),
  ),
});

export type WakeEnv = z.infer<typeof wakeEnvSchema>;

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

export function parseWakeEnv(source: Record<string, string | undefined>): WakeEnv {
  return parseWith(wakeEnvSchema, source);
}

export function parseDatabaseEnv(source: Record<string, string | undefined>): DatabaseEnv {
  return parseWith(databaseEnvSchema, source);
}

let cached: Env | undefined;
let cachedWorker: WorkerEnv | undefined;
let cachedDatabase: DatabaseEnv | undefined;
let cachedWake: WakeEnv | undefined;

/** Full web-app settings (validated eagerly at server start by instrumentation.ts). */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

export function getWorkerEnv(): WorkerEnv {
  cachedWorker ??= parseWorkerEnv(process.env);
  return cachedWorker;
}

export function getWakeEnv(): WakeEnv {
  cachedWake ??= parseWakeEnv(process.env);
  return cachedWake;
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
  cachedWake = undefined;
}
