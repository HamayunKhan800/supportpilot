import type { Breadcrumb, ErrorEvent, NodeOptions } from "@sentry/node";

import type { ErrorReportContext, ErrorReporter } from "../error-reporting";
import { redactQueryValues } from "../query-errors";

/**
 * Sentry settings shared by the web server (@sentry/nextjs) and the worker (@sentry/node)
 * (plan M6 D9; ADR-0018). Errors only, and nothing personal:
 *
 * - `enableOpenTelemetrySetup: false` and no `tracesSampleRate`: our own OpenTelemetry setup
 *   owns tracing, and `openTelemetryIntegration()` links each error to the current trace
 *   (Sentry, "Use Your Own OpenTelemetry Pipeline").
 * - `dataCollection` switched off item by item. In SDK 11 it replaces `sendDefaultPii`, and
 *   its defaults collect user details, cookies, headers, bodies, query strings, AI prompts and
 *   outputs, query data, job arguments and local variable values (@sentry/core 11.8.0,
 *   types/datacollection.d.ts). No Session Replay (server side only).
 * - Integrations that attach request data, local variable values or console output are also
 *   removed, so a changed default cannot bring them back.
 * - beforeSend drops the request and user, and scrubs query values (query-errors.ts), emails,
 *   query strings and token-like strings from messages, the transaction name and breadcrumbs.
 */
type Integration = Parameters<
  Extract<NonNullable<NodeOptions["integrations"]>, (defaults: never) => unknown>
>[0][number];

export const DROPPED_SENTRY_INTEGRATIONS: ReadonlySet<string> = new Set([
  "RequestData", // headers, query string and body of the request
  "LocalVariables",
  "LocalVariablesAsync", // values of local variables in stack frames
  "Console", // console output as breadcrumbs
  "ConversationId",
]);

const EMAIL = /[^\s@<>"'()]+@[^\s@<>"'()]+\.[A-Za-z]{2,}/g;
const QUERY = /\?[^\s#"']*/g;
// Ticket tracking tokens are 32 random bytes in base64url (43 characters); reset and
// verification tokens are similar. UUIDs (record ids) also match the pattern and are kept:
// they identify a row, not a person, and are what you need to debug.
const TOKEN = /[A-Za-z0-9_-]{32,}/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function scrubText(text: string): string {
  return redactQueryValues(text)
    .replace(EMAIL, "[email]")
    .replace(QUERY, "?[query]")
    .replace(TOKEN, (match) => (UUID.test(match) ? match : "[token]"));
}

const PATH = /(^|\s)\/\S*/g;

/**
 * Sentry names an event after the incoming request's real path (`POST /api/v1/portal/acme/...`,
 * `GET /t/<token>`). The app reports the route instead: the handler name or Next.js route pattern
 * (`createPortalTicket`, `/t/[token]`) or the job, and without either the path is hidden.
 */
function transactionName(event: ErrorEvent): string | undefined {
  const route = event.tags?.route;
  const job = event.tags?.job;
  if (typeof route === "string" && route) return route;
  if (typeof job === "string" && job) return `job ${job}`;
  if (!event.transaction) return undefined;
  return scrubText(event.transaction).replace(PATH, (_m, lead: string) => `${lead}/[path]`);
}

export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = { ...event, user: undefined, server_name: undefined };
  if (event.request) scrubbed.request = { method: event.request.method };
  const transaction = transactionName(event);
  if (transaction) scrubbed.transaction = transaction;
  if (event.message) scrubbed.message = scrubText(event.message);
  if (event.exception?.values) {
    scrubbed.exception = {
      ...event.exception,
      values: event.exception.values.map((value) => ({
        ...value,
        value: value.value === undefined ? undefined : scrubText(value.value),
      })),
    };
  }
  if (event.breadcrumbs) {
    scrubbed.breadcrumbs = event.breadcrumbs
      .map((crumb) => scrubBreadcrumb(crumb))
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
  }
  return scrubbed;
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category === "console") return null;
  const url = crumb.data?.url;
  return {
    ...crumb,
    message: crumb.message === undefined ? undefined : scrubText(crumb.message),
    data: crumb.data
      ? {
          ...(typeof crumb.data.method === "string" ? { method: crumb.data.method } : {}),
          ...(typeof crumb.data.status_code === "number" ? { status_code: crumb.data.status_code } : {}),
          ...(typeof url === "string" ? { url: scrubText(url) } : {}),
        }
      : undefined,
  };
}

/**
 * Every kind of data the SDK can collect, switched off. `satisfies Required<...>` makes this a
 * compile error, not a silent default, when an SDK upgrade adds a new kind (SDK 11.9 adds `mcp`,
 * for example): someone has to decide on it before the code builds again.
 */
export const DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  // Source lines around each stack frame are code, not data (and the repository is public),
  // so the default stays: they are what makes a server error readable.
  frameContextLines: 5,
} as const satisfies Required<NonNullable<NodeOptions["dataCollection"]>>;

export interface SentrySettings {
  SENTRY_DSN: string;
  SENTRY_ENVIRONMENT?: string | undefined;
  NODE_ENV: string;
}

export function buildSentryOptions(
  settings: SentrySettings,
  openTelemetryIntegration: () => Integration,
): NodeOptions {
  return {
    dsn: settings.SENTRY_DSN,
    environment: settings.SENTRY_ENVIRONMENT ?? settings.NODE_ENV,
    dataCollection: DATA_COLLECTION,
    enableOpenTelemetrySetup: false,
    maxBreadcrumbs: 30,
    integrations: (defaults) => [
      ...defaults.filter((integration) => !DROPPED_SENTRY_INTEGRATIONS.has(integration.name)),
      openTelemetryIntegration(),
    ],
    beforeSend: scrubSentryEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

/** Adapts Sentry's captureException to the app's reportError hook, with safe tags only. */
export function sentryReporter(
  captureException: (err: unknown, hint: { tags: Record<string, string> }) => unknown,
): ErrorReporter {
  return (err: unknown, context: ErrorReportContext) => {
    const tags: Record<string, string> = {};
    if (context.route) tags.route = context.route;
    if (context.job) tags.job = context.job;
    if (context.jobId) tags.job_id = context.jobId;
    if (context.requestId) tags.request_id = context.requestId;
    captureException(err, { tags });
  };
}
