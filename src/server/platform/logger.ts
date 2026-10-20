import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

/**
 * Paths redacted from every log line (OWASP A09: log useful events without
 * leaking secrets or personal data). `*.x` matches one level deep.
 */
export const REDACT_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "apiKey",
  "*.apiKey",
  "secret",
  "*.secret",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "headers.authorization",
  "headers.cookie",
  'headers["set-cookie"]',
  "email",
  "*.email",
  "body",
  "*.body",
  "prompt",
  "*.prompt",
  "databaseUrl",
  "*.databaseUrl",
] as const;

export function createLogger(
  options: { level?: string; pretty?: boolean } = {},
  destination?: DestinationStream,
): Logger {
  const config: LoggerOptions = {
    level: options.level ?? "info",
    base: { service: "supportpilot" },
    redact: { paths: [...REDACT_PATHS], censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
  return destination ? pino(config, destination) : pino(config);
}

// Read LOG_LEVEL directly (not via getEnv) so logging works even when other
// env vars are invalid, which is exactly when you need logs most.
const globalForLogger = globalThis as unknown as { __spLogger?: Logger };

export const logger: Logger =
  globalForLogger.__spLogger ??
  createLogger({ level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info") });

if (process.env.NODE_ENV !== "production") globalForLogger.__spLogger = logger;
