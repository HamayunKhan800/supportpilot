# ADR-0018 · Observability without customer data

Status: Accepted · Date: 2026-10-23 · Extends: [ADR-0015](0015-text-generation-gateway.md) · Code: `src/server/platform/telemetry/`, `src/server/platform/error-reporting.ts`, `src/instrumentation*.ts`, `src/worker/traced-job.ts` · Guide: [docs/observability.md](../observability.md)

## Context

NFR-OBS2 asks for traces and error reporting (M6 plan D7–D9). SupportPilot handles customer conversations, help articles and private tracking links, and since M5 the rule has been that none of it is logged (OWASP LLM02, sensitive information disclosure). The tools we would add collect a lot by default:

- **Sentry SDK 11** replaced `sendDefaultPii` with `dataCollection`, whose defaults collect user details, cookies, headers, request bodies, query strings, AI prompts and answers, database query data, job arguments and local variable values (`@sentry/core` 11.8.0, `types/datacollection.d.ts`).
- **The AI SDK** records full prompts and answers by default once a tracer is registered; telemetry is opt-out per call ([AI SDK telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)).
- **Next.js** puts `http.target`, the raw request path, on its root span ([Next.js OpenTelemetry guide](https://nextjs.org/docs/app/guides/open-telemetry)). On `/t/<token>` pages that path is the customer's private link.
- **Automatic instrumentation** for Postgres and HTTP records SQL text and full URLs; resource detectors record host names and process arguments.

## Decision

- **Manual OpenTelemetry, off unless configured.** Tracing starts only when `OTEL_EXPORTER_OTLP_ENDPOINT` (or the traces-specific variable) is set, in both the web app (`instrumentation.ts`) and the worker. It uses the OpenTelemetry JS 3.0 SDK (`@opentelemetry/sdk-trace`), with no automatic instrumentation and no resource detectors (only service name and version). The app adds spans where they answer a question: jobs, AI calls, knowledge search and drafts. Next.js, Better Auth and pg-boss add their own.
- **An exact allowlist at export.** Every span passes through `RedactingSpanExporter`, which keeps only listed attribute names, rewrites span names that contain a path to the route pattern, strips paths and queries from URLs, drops status messages, and keeps only `exception.type` from exception events. A denylist would let through whatever a library adds next. With an allowlist, a new attribute is dropped until someone decides it is safe.
- **AI SDK telemetry off on every call** (`telemetry: { isEnabled: false }`), embeddings included. The plan (D8) said to turn off only input and output recording; switching the SDK's telemetry off entirely is simpler to verify, and the gateway's own `ai <feature>` span records what matters (model, tokens, cost, latency, time to first token, fallback, outcome) from data it already has.
- **No propagator.** A W3C propagator would continue traces from any `traceparent` header a client sends, and would add trace headers to outgoing calls such as those to Google's API. Nothing here needs cross-service traces, so none is registered.
- **Jobs are traced separately from the request that queued them.** Carrying trace context through pg-boss job data would link them, but it would put tracing data in stored job rows and would need care with retries. The two share `sp.ticket_id`, which is enough to find one from the other at this size.
- **Sentry for server errors, with everything collected switched off.** Every `dataCollection` field is set to off, and the object is checked with `satisfies Required<...>` against the SDK's own type, so an upgrade that adds a new kind of data fails to compile until it is decided. The integrations that attach request data, local variables or console output are removed, so a changed default cannot bring them back. `beforeSend` removes the user and server name, reduces the request to its method, replaces failed-query values (Drizzle and Postgres both put them in error messages; the logger's `err` serializer does the same), and scrubs emails, query strings and token-like strings (UUIDs exempt, so IDs stay readable). Sentry reads the app's OpenTelemetry spans instead of starting its own (`enableOpenTelemetrySetup: false`, per [Sentry's custom OpenTelemetry setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/opentelemetry/custom-setup/)). Source lines around stack frames are kept: they are code, not data, and the repository is public.
- **One reporting seam.** `reportError(err, context)` is the only way code reports an error: 500 responses in `withRoute`, Next.js `onRequestError`, and a job's final failed attempt. Its context type allows only route, request ID, job name and job ID. With no reporter configured it does nothing.
- **Browser error reporting is deferred.** The plan (D9) said browser errors would go through the app's own server so the strict CSP needs no new origin. Server errors are where customer-affecting failures show up; a browser endpoint is new attack surface (it accepts unauthenticated input) and is left for M7/M8.

## Consequences

- Traces show where time goes (the first real run showed each draft request looking up the session twice), and errors arrive with stacks and trace links, without customer data leaving the process. `tests/integration/telemetry-privacy.test.ts` runs the real flows through the real exporter and fails if any of their text or a tracking token appears in a span. A manual check against the production server and bundled worker found none either (docs/observability.md).
- The allowlist has to be maintained: an attribute is visible only after it is added to `SPAN_ATTRIBUTES`. That is deliberate friction.
- Without automatic instrumentation there are no per-query database spans. Slow queries show up as time inside an app span, not as named SQL. Adding the Postgres instrumentation later would need its statement text turned off and its attributes reviewed against the allowlist.
- Request and job traces aren't linked; a slow triage has to be found through the ticket ID.
- Every trace is kept (no sampling), which is fine at demo traffic. M8 sets sampling with the chosen backend.
