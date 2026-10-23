/**
 * Reports unexpected errors to an error tracker (plan M6 D9; ADR-0018). The app calls
 * `reportError`; at start-up the web server or the worker plugs in Sentry when SENTRY_DSN is
 * set (src/server/platform/telemetry/sentry.ts). Unset, reporting does nothing, so tests and
 * local work need no account and no Sentry code is loaded.
 *
 * Only for failures someone should look at: an unhandled error in a route, a job that failed
 * unexpectedly or for the last time. Expected failures (validation, rate limits, the AI
 * provider being busy) are logged and counted, not reported.
 */
export interface ErrorReportContext {
  /** Route handler name or Next.js route pattern (`/t/[token]`), never a concrete path. */
  route?: string;
  job?: string;
  jobId?: string;
  requestId?: string;
}

export type ErrorReporter = (err: unknown, context: ErrorReportContext) => void;

const holder = globalThis as unknown as { __spErrorReporter?: ErrorReporter };

export function setErrorReporter(reporter: ErrorReporter | undefined): void {
  holder.__spErrorReporter = reporter;
}

export function reportError(err: unknown, context: ErrorReportContext = {}): void {
  try {
    holder.__spErrorReporter?.(err, context);
  } catch {
    // Reporting must never turn into a second failure.
  }
}
