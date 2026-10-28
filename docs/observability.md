# Observability

SupportPilot has three signals, all optional except logs:

| Signal | What it answers                                    | On when                       | Where it goes                         |
| ------ | -------------------------------------------------- | ----------------------------- | ------------------------------------- |
| Logs   | What happened, in order, with IDs                  | Always                        | stdout, one JSON object per line      |
| Traces | Where the time went in one request or job          | `OTEL_EXPORTER_OTLP_ENDPOINT` | Any OTLP/HTTP backend (JSON encoding) |
| Errors | Which server errors happen, how often, with stacks | `SENTRY_DSN`                  | Sentry                                |

The rule for all three is the one M5 set for logs: **no customer text, prompts, AI answers, article text, emails or tracking tokens.** IDs, counts, timings, model names and outcomes are fine. Design: [ADR-0018](adr/0018-observability-without-customer-data.md).

## Logs

Pino writes JSON to stdout (NFR-OBS1). Keys such as `password`, `token`, `email`, `body` and `prompt` are redacted, and every error logged under `err` passes through `query-errors.ts`, which replaces the values a failed query carries (Drizzle appends them to the error message, and Postgres quotes a value it can't convert) while keeping the SQL. Each request has a `requestId`, and when tracing is on, every line written inside a span also has `trace_id` and `span_id`, so one search finds the matching trace. Without tracing, those two fields are absent; nothing else changes.

## Traces

### Turning them on

Set `OTEL_EXPORTER_OTLP_ENDPOINT` for the web app and the worker (they report as `supportpilot-web` and `supportpilot-worker`). The traces URL follows the OpenTelemetry spec: `/v1/traces` is appended to the base endpoint, or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is used exactly as given. `OTEL_EXPORTER_OTLP_HEADERS` (for example `x-api-key=...`) is for hosted backends that need a key. With neither endpoint set, no tracing code runs at all.

Every trace is kept (no sampling). At demo traffic that costs nothing. M8 revisits it with the chosen backend's quota.

### Viewing them locally

**Without Docker:** a tiny receiver that prints one line per span.

```sh
pnpm otel:capture                       # listens on 127.0.0.1:4318
pnpm otel:capture --out /tmp/spans.jsonl   # also keeps every span as JSON
# in another terminal:
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 pnpm dev
```

**With Jaeger** (a full UI at http://localhost:16686), using the command from [Jaeger's getting-started page](https://www.jaegertracing.io/docs/latest/getting-started/) (version 2.22, October 2026), trimmed to the two ports used here:

```sh
docker run --rm --name jaeger -p 16686:16686 -p 4318:4318 cr.jaegertracing.io/jaegertracing/jaeger:2.22.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 pnpm dev
```

### What a trace contains

Next.js creates the request spans itself (`GET /t/[token]`, `render route (app) /app/tickets`, ...). Better Auth (`handler /get-session`, `db findOne session`) and pg-boss (`process ai.triage`) add their own. The app adds:

| Span             | Where                   | Attributes (besides IDs)                                                                             |
| ---------------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `job <queue>`    | worker, one per job     | `sp.job.queue`, `sp.job.attempt`, `sp.job.outcome`                                                   |
| `ai <feature>`   | every AI call (gateway) | `gen_ai.*` (provider, model, tokens, finish reasons), `sp.ai.outcome`, cost, latency, TTFT, fallback |
| `kb.search`      | knowledge base search   | `sp.kb.top_k`, `sp.kb.results`, embedding and retrieval times                                        |
| `draft.generate` | one per draft           | `sp.draft.outcome`, `sp.draft.error_code`, `sp.kb.top_score`, invalid citation count                 |

IDs are `sp.workspace_id`, `sp.ticket_id`, `sp.document_id`, `sp.draft_id` and `sp.job.id`: random identifiers that mean nothing outside the database. A failed span gets `error.type`, a short code such as `ai_timeout` or a Postgres error code, never the error message.

A job's trace is separate from the request that queued it. They share `sp.ticket_id`, which is how to find one from the other (ADR-0018 explains why no trace context is passed through the queue).

### How customer text is kept out

1. **Nothing collects it by default.** There is no automatic instrumentation (it records SQL text and full URLs), no resource detectors (host names, process arguments) and no propagator. The AI SDK's own telemetry, which records prompts and answers by default once a tracer exists, is switched off on every call, embeddings included.
2. **An exact allowlist at export.** Every span passes through `RedactingSpanExporter` (`src/server/platform/telemetry/exporter.ts`) before it leaves the process. It keeps only the attribute names listed in `ALLOWED_SPAN_ATTRIBUTES` (the app's own, plus the route pattern, HTTP method and status, the host name of an outgoing call, and a few Next.js span-type fields) and drops everything else. Span status messages are dropped too; only the status code is kept. Next.js's `http.target` (the raw path, which contains a tracking token on `/t/...` pages) is dropped this way, as is anything a library adds in a future version. Span names that contain a path are rewritten to the route pattern, and URLs lose their path and query. Exception events keep only `exception.type`.
3. **Tests.** `tests/integration/telemetry-privacy.test.ts` runs the real flows (portal request, triage job, upload and ingest, search, draft, customer reply) through the real exporter, and fails if any of their text or the tracking token appears in any span. Unit tests cover the allowlist, name rewriting and the AI SDK switch, and were checked by breaking the code on purpose (allowing `http.target`, removing the switch) to make sure they fail.

Adding an attribute means adding it to `SPAN_ATTRIBUTES` in `spans.ts`, which puts it on the allowlist. Only add values that are safe to show anyone who can read the traces.

### Checking for leaks

The tests run the app's code, but not Next.js's production server or the bundled worker. To check those by hand (last done 2026-10-23, below):

1. `pnpm build && pnpm build:scripts`, then `pnpm otel:capture --out /tmp/spans.jsonl`.
2. Start the server and worker with `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` (`node scripts/start-standalone.mjs`, `node .build/worker.mjs`).
3. Use the app with text you'd recognise: a portal request with an unusual name and subject, the tracking link, a customer reply, sign-in, a knowledge search, a draft, and URLs with query strings such as `/reset-password?token=...`.
4. Search `/tmp/spans.jsonl` for each word, the tracking token, the email address and the session cookie. Expect zero matches, and span names with route patterns (`GET /t/[token]`).

**2026-10-23 result:** 348 spans (344 web, 4 worker); 0 matches for the tracking token, the customer's name, email, subject, message and reply text, the reset token, the signed-in user's email, the session cookie, or any `?` query string. The only attribute names present were allowlisted ones.

## Errors (Sentry)

### Turning it on

1. Sign up at [sentry.io](https://sentry.io) (the free Developer plan covers one user and 5,000 errors a month) and create a **Node.js** project.
2. Copy the DSN (Project Settings > Client Keys (DSN)). Sentry describes DSNs as safe to make public: they can only send events, not read anything ([Sentry docs](https://docs.sentry.io/concepts/key-terms/dsn-explainer/)). It still belongs in the environment, not in code.
3. Set `SENTRY_DSN` (and optionally `SENTRY_ENVIRONMENT`, default `NODE_ENV`) for the web app and worker.
   Note that `pnpm dev` loads `.env.local`, so a DSN kept there also reports development errors (tagged with that file's `SENTRY_ENVIRONMENT`, and scrubbed like production). To keep local work out of Sentry, run with `SENTRY_DSN=` or keep the DSN out of `.env.local` and pass it only to `pnpm sentry:check`.
4. Run `SENTRY_DSN=... pnpm sentry:check`. It sends one "SupportPilot Sentry check" error through the app's own reporting path and exits 1 unless Sentry answers with HTTP 2xx. (The SDK's `close()` reports success even when sending failed, so the script checks the real response.)

### What is reported

Server errors only: a request that ends in a 500 (with tags `route` and `request_id`), a request error Next.js reports through `onRequestError`, and a job's final failed attempt (tags `job`, `job_id`). Earlier attempts that will be retried are not reported. When tracing is on, each error is linked to its trace.

### What is not sent

Sentry SDK 11 collects a lot by default: user details, cookies, headers, request bodies, query strings, AI prompts and answers, query data, job arguments and local variable values. The app turns every one of those off with `dataCollection` (a compile-time check fails if an SDK upgrade adds a kind the app hasn't decided on), removes the integrations that attach request data, local variables or console output, and scrubs every event in `beforeSend`: no user or server name, the request reduced to its method, failed-query values replaced in every exception (linked causes included), the event named after the reported route or job instead of the request's real path, and emails, query strings and token-like strings replaced in messages, the transaction name and breadcrumbs. Sentry does not set up its own tracing; it reads the app's OpenTelemetry spans.

Stack traces keep the source lines around each frame (`frameContextLines: 5`). Those are lines of code, not data, and the repository is public. `tests/unit/sentry-sdk.test.ts` checks all of this against the real SDK, with a transport that keeps the event in memory.

### Limits

- **Browser errors are not reported.** Only the server's. Reporting them would need either a new CSP origin or a reporting endpoint in the app; that is left for later (ADR-0018).
- **Local variables:** besides the switches above, Sentry's Node SDK only captures local variables for uncaught exceptions. The guard against them is the removed integration, which a test checks.

## Not covered yet

- **Alerts (M8):** the **Uptime** workflow checks the live site once a week (Mondays) and GitHub emails the owner when it fails; AWS Budgets emails at 50% and 100% of $5 a month. What to do when one arrives: [runbook](runbook.md).
- **Sentry in production:** wired and tested, but switched on later (owner's choice, 2026-10-28). To turn it on: store the DSN as `/supportpilot/production/shared/SENTRY_DSN` in SSM and run Deploy; the functions already set `SENTRY_ENVIRONMENT=production`.
- No hosted tracing backend: the live functions don't export traces.
- No metrics (request rates, queue depth). The dashboard in step 5 shows AI usage from the database.
