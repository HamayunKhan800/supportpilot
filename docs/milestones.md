# Milestone Log

Each entry records what was built, **how it was verified**, and what is still open. Claims here are backed by commands that were actually run.

## M0 · Requirements & design: complete (2026-10-19)

Requirements, architecture, threat model, AI evaluation plan, 9 ADRs. Mermaid diagrams validated with the official parser.

## M1 · Foundation: complete (2026-10-20)

### Built

- Next.js 16.4.2 (App Router, Cache Components) + React 19.3, TypeScript strict (+ `noUncheckedIndexedAccess`), Node.js 24 LTS (ADR-0010).
- Platform layer: Zod env validation, pino structured logging with redaction, RFC 9457 errors, request IDs, route wrapper, baseline security headers (Proxy), liveness/readiness probes.
- PostgreSQL 17 + pgvector via Drizzle. The first migration enables `vector`. A bundled migration CLI (`.build/migrate.mjs`) runs without `node_modules`.
- Multi-stage Dockerfile (non-root UID 1000, HEALTHCHECK), docker-compose for local dev.
- GitHub Actions: CI (quality, integration, build+smoke, Docker), Security (CodeQL, gitleaks, dependency review), Dependabot. All actions pinned to verified commit SHAs.

### Verified in the development sandbox

| Check                                                                                                                         | Result                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ESLint (zero warnings), incl. a probe file proving the a11y, `no-explicit-any` and architecture-boundary rules fire           | ✅                                                                                          |
| `tsc --noEmit` strict                                                                                                         | ✅                                                                                          |
| Prettier check                                                                                                                | ✅                                                                                          |
| Unit tests                                                                                                                    | ✅ 46 passed. Coverage: 98.9% lines, 100% functions, 79.2% branches (thresholds 80/80/75)   |
| Integration tests (real PostgreSQL 17.11 + pgvector 0.8.0): migrations, idempotency, vector ops, statement timeout, readiness | ✅ 6 passed                                                                                 |
| Production build **without** `DATABASE_URL`                                                                                   | ✅ health/ready are dynamic (ƒ), not prerendered                                            |
| Fail-fast: server exits 1 on invalid config                                                                                   | ✅ (initially it **did not**: Next.js logged the error and served 500s. Fixed)              |
| Smoke tests against the production standalone server                                                                          | ✅ 6 passed                                                                                 |
| DB outage: `/api/ready` → 503 problem+json, `/api/health` stays 200, recovers when DB returns                                 | ✅                                                                                          |
| Bundled migration CLI in an empty directory (no node_modules)                                                                 | ✅                                                                                          |
| actionlint 1.7.12 (+ shellcheck) on workflows                                                                                 | ✅ no issues                                                                                |
| hadolint 2.15.1 on Dockerfile                                                                                                 | ✅ no issues                                                                                |
| gitleaks 8.30.1 on git history                                                                                                | ✅ no leaks                                                                                 |
| `pnpm audit --prod`                                                                                                           | ✅ 0 vulnerabilities (dev-only: 1 accepted, 1 fixed. See `docs/security/accepted-risks.md`) |

### Issues found and fixed during verification

1. **Server did not fail fast** on invalid env (served 500s). → `process.exit(1)` in Node-only instrumentation.
2. **Edge-runtime build warning** from `process.exit`. → Moved to `instrumentation-node.ts` (pattern from Next.js docs).
3. **Readiness log had an empty error** during a DB outage (Node network errors have empty messages). → Fall back to the error code (`ECONNREFUSED`). Unit test added.
4. **Deliberate 503 logged as "unhandled error" with stack** (alert noise). → Expected `AppError`s are logged without stacks.
5. **Request paths in error logs could contain secrets** (future tracking tokens). → Log route patterns only.
6. A **false-positive check** in my own verification script (a failed `cd` produced exit 1). Re-run with explicit guards.
7. **First CI run on GitHub failed in the Docker and build-smoke jobs: `public/` was missing.** Git does not track empty directories, and the scaffold's sample files had been deleted. Local checks had passed only because the empty folder still existed in the sandbox. → Added `public/robots.txt` (keeps crawlers off `/api/`), plus a smoke test that fetches it so a missing `public/` fails with a clear message. Lesson: a clean-checkout CI run catches what a long-lived dev environment hides.
8. **Dependabot was not watching the Docker base image.** The Dockerfile named it via `ARG NODE_IMAGE` + `FROM ${NODE_IMAGE}`, and Dependabot's parser skips `FROM` lines that use variables (dependabot-core#4597, #2057), so Node/OS security patches would never have been proposed. → Literal `FROM` lines pinned by digest. `dependabot.yml` now records the "stay on Node 24 LTS" policy (ADR-0010) for the image and `@types/node`. Expected proof: Dependabot proposes `node:24.22.1-trixie-slim`.

### Not yet verified (requires GitHub / Docker; first CI run)

- GitHub Actions workflows have been statically checked but **not executed yet**. They will run on the first push.
- `docker build` and the container smoke test (the sandbox has no Docker daemon). These are covered by the CI `docker` job.
- `docker compose` local setup.

### Open items carried forward

- Full nonce-based CSP (script/style) → M2.
- ESLint 10 upgrade is blocked on plugin peer support (jsx-a11y, react, import).
- Choose and verify the hosting platform → M8.

## M2 · Authentication & multi-tenancy: complete (2026-10-21, CI run 39640206795)

### Step 1–2: auth backend, schema, tests (2026-10-21)

- Better Auth 1.7.12 + organization plugin (workspace = organization), Drizzle adapter. Tables generated with the official CLI (`pnpm auth:generate`), then hardened: `timestamptz`, unique `(organization_id, user_id)` on `member`, default role `agent`. Migration `0001_m2_auth_workspaces.sql` adds `workspace_settings` and an append-only `audit_log`.
- Role matrix in one module (`src/server/platform/auth/permissions.ts`), used by Better Auth and by `requireWorkspace()` for app services. Unit tests mirror docs/01-requirements.md §2.1 row by row.
- Passwords: 15–128 characters, no composition rules, breached-password check (NIST SP 800-63B-4 §3.1.1.2).
- Integration tests against real PostgreSQL go through Better Auth's HTTP handler (where rate limiting and CSRF apply): sign-up and sign-in, cookie flags, sign-out revocation, password change revoking other sessions, CSRF, rate limiting, the role matrix, cross-tenant IDOR attempts, invitations, and audit entries.

### Step 3–5: CSP, UI and end-to-end tests (2026-10-21)

- Strict per-request nonce CSP (ADR-0011). Pages: sign-up, sign-in, onboarding, workspace overview, members (invite, change role, remove, cancel invitation), audit log, account (change password), invitation accept/decline.
- shadcn/ui (Base UI) components, light theme, system fonts. Forms: labelled fields, errors linked with `aria-describedby`, focused error alerts, correct `autocomplete`.
- Playwright E2E against the production build: the full owner → invite → agent journey, invite single use, open-redirect protection, forged cookies, CSP on every page, and axe WCAG 2.2 AA scans on desktop and mobile (0 serious/critical). Every test fails on any CSP violation.
- Demo seed (`pnpm db:seed-demo`): "Nimbus Cloud Storage" with one owner, admin and agent. The password comes from `DEMO_PASSWORD` and is never committed.

### Findings while verifying Better Auth defaults (ADR-0004)

| #   | Finding                                                                                                                                                                                                                                                | Action                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 9   | **Origin/CSRF checks are skipped automatically in test environments** (`skipOriginCheck: isTest()`). A cross-origin sign-in returned 200 in our test.                                                                                                  | Set `advanced.disableOriginCheck: false` explicitly. Tests now prove a 403. Removing the line makes 2 tests fail (checked).        |
| 10  | **Global after-hooks do not receive the endpoint's session**, so every audit entry had `actor_user_id = NULL`.                                                                                                                                         | Resolve the actor with `getSessionFromCtx` (documented API) for auditable events only. A test asserts every entry has an actor.    |
| 11  | `auth.api.*` server calls bypass rate limiting (documented).                                                                                                                                                                                           | UI forms call `/api/auth/*` over HTTP. Server Actions never call sign-in/sign-up.                                                  |
| 12  | Probing a foreign workspace clears the caller's active workspace.                                                                                                                                                                                      | Fails closed. Documented as AR-003; the app re-selects a workspace.                                                                |
| 13  | Denials come back as 400, 401 or 403 depending on which check fires first (e.g. "cannot leave without an owner" before our owner guard).                                                                                                               | Tests assert _denied (4xx) and database unchanged_ rather than one status code.                                                    |
| 14  | Better Auth's default logger prints plain text.                                                                                                                                                                                                        | Routed into pino JSON logs (message only).                                                                                         |
| 15  | **Next.js renders a layout and its page in parallel.** On the first `/app` load, the page checked permissions before the layout had re-selected the active workspace, so it failed with a 403. Found by the E2E suite (server log).                    | Layout and pages share one per-request context (React `cache()`), and pages await it before calling services.                      |
| 16  | Next.js's **built-in error page uses inline styles**, which our CSP blocks, so errors rendered unstyled. Caught by the E2E CSP-violation check.                                                                                                        | Own `error.tsx`, `global-error.tsx` and `not-found.tsx`, styled with classes. Tested by a 404 E2E test.                            |
| 17  | If JavaScript fails, a `<form>` without `method` submits as **GET, putting the password in the URL** (logs, history).                                                                                                                                  | Credential forms use `method="post"`. An E2E test asserts it.                                                                      |
| 18  | `shadcn init` added the **shadcn CLI as a production dependency** and Google-hosted fonts, which would break the CSP.                                                                                                                                  | Moved to devDependencies; system fonts. `cn()` helper checked against the published shadcn source.                                 |
| 19  | shadcn's default **error red failed WCAG contrast** at 90% opacity (axe "serious").                                                                                                                                                                    | Darkened the `--destructive` token to red-700 (≈5.9:1 on white).                                                                   |
| 20  | `addMember` is a **server-only endpoint without a URL path**, so the path-based audit hook never saw it: direct additions were not audited. The same plugin hook also fires on workspace creation.                                                     | `afterAddMember` hook logs a system event, skipping the creator's owner membership. An integration test asserts exactly one event. |
| 21  | **Audit-log paging silently skipped entries.** The cursor was a JS timestamp (milliseconds) while PostgreSQL stores microseconds, so entries within the same millisecond at a page boundary were lost. A test reproduced it (1 of 3 entries returned). | Keyset pagination on `(created_at, id)` in SQL, with the entry id as the cursor (validated as a UUID). Regression test added.      |

## M3 · Ticketing: complete

Plan: [`docs/plans/m3-ticketing.md`](plans/m3-ticketing.md) (approved 2026-10-22).

### Step 1: database (2026-10-22)

- Migration `0002`: `ticket`, `ticket_message`, `ticket_counter`, `app_rate_limit`.
- Tenant integrity enforced by the database itself, not only by application code:
  - A composite FK makes a message unable to reference another workspace's ticket.
  - A composite FK to `member(organization_id, user_id)` with `ON DELETE SET NULL (assignee_id)` only allows workspace members as assignees, and unassigns tickets when someone leaves.
  - CHECK constraints on status, priority, author type, and "internal notes are written by agents".
- Per-workspace ticket numbers via an atomic upsert (20 concurrent inserts: no gaps or duplicates). Optimistic concurrency via `version`.
- 17 integration tests: tenant isolation, constraints (asserting SQLSTATE codes), concurrency, internal-note hiding, search, keyset paging with timestamp ties.

| #   | Finding                                                                                                                                                                                  | Action                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 22  | **Search negation leaked through.** With one search vector per message, `help -laptop` still matched the "Laptop setup" ticket because one of its messages said "help" without "laptop". | One search document per ticket (subject, customer, all messages), updated in the same transaction as each message. |
| 23  | **Thread order was random within a transaction.** `now()` is the transaction start time, so two messages written together had identical timestamps and were ordered by random UUID.      | Identity column `seq` orders the thread.                                                                           |

### Step 2: rules and services (2026-10-22)

- **Lifecycle state machine** (`lifecycle.ts`): all 16 status pairs unit-tested. A customer reply reopens pending/resolved tickets. Closed is final.
- **Tracking tokens:** 256-bit, SHA-256 hash stored, format-checked before any query. A test asserts the raw token appears nowhere in the stored row.
- **Zod schemas** shared by the API and UI: whitespace/CRLF normalization, NUL bytes removed, length limits after trimming.
- **Postgres rate limiter:** keys are HMAC'd, so no raw IPs or tokens are stored. Concurrency test: 25 parallel requests with a limit of 10 lets exactly 10 through. Portal limits: per IP, per workspace, per ticket. See AR-004 for the proxy caveat.
- **Ticket service:** every agent call checks the role from the database and is scoped to the caller's workspace. Malformed ids return 404. Row locks guard customer/agent races. Optimistic concurrency returns 409.
- **Ticket changes and their audit entries commit together** (strict `insertAuditEvent` in the same transaction). Audit metadata holds no personal data.
- 26 service integration tests. Mutation-checked: deliberately (1) showing internal notes to customers, (2) writing the audit entry outside the transaction, and (3) skipping the lifecycle check each made the intended test fail.

| #   | Finding                                                                                                                                               | Action                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 24  | A **NUL byte** in a portal message would reach PostgreSQL, which rejects `\0` in text, and surface as a 500.                                          | Schemas strip NUL bytes. Unit and integration tests cover it.                                                                      |
| 25  | A **malformed ticket id** in a URL would hit the uuid cast in PostgreSQL and return a 500.                                                            | Ids are validated first and return 404, like foreign ids.                                                                          |
| 26  | The M2 audit writer swallows errors (correct for auth hooks that run after the change), but **reusing it for tickets would allow unaudited changes**. | Separate strict writer inside the transaction, with a test that forces the audit insert to fail and checks the change rolled back. |

### Step 3: REST API and OpenAPI (2026-10-22)

- **7 endpoints under `/api/v1`** (portal, tracking link, agent queue/detail/update/reply) plus `/api/v1/openapi.json`. One operation registry (`src/server/api/operations.ts`) both validates requests and generates the **OpenAPI 3.1** document, so the docs can't drift from what the server enforces.
- Response shapes are **strict Zod schemas** and fields are opted in one by one by serializers, so a new database column can't leak by accident.
- **Request hygiene** in one wrapper: JSON only (415), 64 KB limit enforced while streaming (413), malformed JSON (400), malformed path ids (404), `Cache-Control: no-store`, and `Retry-After` on 429.
- **CSRF defence in depth:** cookie-authenticated writes must come from the app's own origin (or `AUTH_TRUSTED_ORIGINS`); `Sec-Fetch-Site: cross-site` is refused. Public portal writes carry no credentials, so they need no Origin.
- **Tests generated from the registry**, so a new endpoint is automatically held to the same rules: every ticket-id route returns 404 across workspaces (NFR-SEC1), every agent route returns 401 signed out and 403 without a workspace, and works for owner, admin and agent. The OpenAPI document is checked with an independent OpenAPI 3.1 schema validator, and route folders must match the registry in both directions.
- 38 API integration tests, 28 unit tests, 3 smoke tests (run against the production build and the Docker image in CI). Mutation-checked: removing the CSRF check, leaking an extra field, buffering bodies without the cap, echoing the token in errors, and renaming a documented path each failed the intended test.

| #   | Finding                                                                                                                                                                                                                                  | Action                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 27  | **Tracking-token responses sent the site-wide `Referrer-Policy` instead of `no-referrer`.** The proxy's security headers overwrote the route's header. Handler-level tests passed; a check against the real production server caught it. | The proxy picks `no-referrer` for secret-token paths (`/t/…`, `/api/v1/portal/t/…`), unit-tested. A smoke test now checks the header through the real server, and fails if the fix is reverted. |
| 28  | The first generated OpenAPI document **referenced `#/$defs/…`, which doesn't exist in OpenAPI**. The validator rejected it.                                                                                                              | Response schemas live in a dedicated registry rendered by Zod's documented multi-schema mode, with references pointing at `#/components/schemas/…`.                                             |
| 29  | **Request limits were missing from the docs.** Zod's input mode renders a trim-then-check pipe as a bare `string`.                                                                                                                       | The generator copies the post-trim checks (lengths, email format) into the request schema; a unit test asserts e.g. subject 3–200.                                                              |
| 30  | Error bodies included the request path as `instance`, which for tracking routes **contains the secret token**.                                                                                                                           | `withRoute` can redact the path; tracking routes do. Tests assert the token never appears in error bodies.                                                                                      |

### Step 4: customer portal UI (2026-10-22)

- **`/p/{slug}`:** request form with a personal-data notice (D10), inline errors tied to each field, focus moved to the first invalid field, `method="post"` so a script failure can never put personal data in the URL, and an off-screen honeypot skipped by keyboard and screen readers.
- **Success screen:** the private link is shown once, with Copy (and a manual fallback when the clipboard is unavailable) and a "save this link" warning.
- **`/t/{token}`:** conversation (customer vs. support team, with the agent's name), reply form, and replies turned off once the request is closed. The URL holds a secret, so the page is `no-store`, `noindex`, and sends no Referer (header plus meta tag). The page title never contains the token.
- The browser forms call the same `/api/v1` endpoints, so the UI goes through the validated, rate-limited path. Shared limits moved to a dependency-free module, so the client bundle doesn't include server code.
- The workspace overview now shows the portal link.
- 3 E2E tests (full customer journey with clipboard, internal notes never shown, closed state, honeypot, 404s) and axe audits of the form, its error state, the success screen and the tracking page on desktop and mobile: 0 serious or critical violations. Mutation-checked: dropping the honeypot value and removing the focus move each failed the intended test.
- Screenshots: `docs/screenshots/m3-portal-*-mobile.png`, `m3-tracking-page-mobile.png`.

| #   | Finding                                                                                                                                                                                 | Action                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 31  | The first honeypot E2E test **passed without testing anything**: its helper reloaded the page after the trap was filled. A deliberate mutation (form not sending the field) exposed it. | The helper fills the trap after the page loads; the mutation now fails the test. |
| 32  | The shared `Alert` always has `role="alert"`, which would make screen readers interrupt with static notices on page load.                                                               | Static notices use `role="note"`; `role="alert"` is kept for real errors.        |

### Step 5: agent inbox UI (2026-10-22)

- **`/app/tickets`:** status tabs with live counts (Active = open + pending, the default), full-text search (words, `-exclude`, or `#12` for a ticket number), filters for priority, category and assignee ("Me", "Unassigned", or a teammate), and sorting. Filters live in the URL, so a filtered view can be bookmarked or shared. The form is a plain GET form, so it also works without JavaScript. A tampered URL shows an explanation instead of an error page. Paging uses keyset cursors (D9).
- **`/app/tickets/{number}`:** the conversation shows who wrote each message. Internal notes are amber and say in words "not visible to the customer" (colour is never the only signal). Public replies have a blue edge.
- **Composer:** you choose "Public reply" or "Internal note", and the label, button and hint change with it. Once a ticket is closed, only internal notes are possible.
- **Details panel:** status, priority, category and assignee. Impossible status moves are disabled in the list, not just rejected by the server. Only changed fields are sent, together with the version number (D4). If someone else saved first, the agent sees what happened and a "Load latest version" button, and their colleague's change is never silently overwritten.
- **Navigation:** a Tickets tab, which stays highlighted inside a ticket (`aria-current="true"`; `"page"` only on the exact page).
- **Layering:** the app layer still cannot import the database layer. A lint rule enforces this, and it flagged three of my first imports. Pages now use a small public `tickets/types.ts`. Client components import only types from it, which disappear at build time.
- **Tests:** 1 integration test (`getInboxOptions`: counts, members, categories, cross-tenant, 403). 3 E2E tests:
  - the full agent journey, including the customer's tracking page showing the reply but not the note, and the audit trail;
  - two tabs editing the same ticket, then closing it;
  - cross-workspace 404 and an invalid filter URL.
- **Accessibility:** axe audits of the inbox, its invalid-filter state and the ticket page on desktop and mobile found 0 serious or critical violations.
- **Mutation-checked:** removing the closed-ticket fix and removing the internal-note label each failed the intended test.
- Screenshots: `docs/screenshots/m3-inbox-{desktop,mobile}.png`, `m3-ticket-{desktop,mobile}.png`.

| #   | Finding                                                                                                                                                                                                  | Action                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 33  | After an agent closed a ticket, the composer kept "Public reply" selected but disabled. The agent could type a reply and only learn on Send that it was refused. Found by the new E2E test, not by hand. | Reply mode is now derived from the ticket status instead of stored, so a closed ticket always means "internal note". |
| 34  | On a phone, four full-width filter menus pushed the first ticket below the fold. Found by reviewing screenshots.                                                                                         | Filters use two columns on small screens.                                                                            |
| 35  | My screenshot script hit the CSRF guard (403): it sent the agent's session cookie without an `Origin` header, which is exactly what a forged cross-site request looks like.                              | No code change. This is the protection working. The script now sends `Origin` like a real browser.                   |

### Step 6: finish: demo data, last journeys, ADR-0012 (2026-10-22)

- **25 synthetic demo tickets** (`src/server/modules/tickets/demo/tickets.ts`), loaded by `pnpm db:seed-demo`:
  - Every status, priority and category, plus unassigned tickets, internal notes and customer follow-ups.
  - Each ticket carries correct category and priority labels (`expected`), so the set doubles as the M5/M6 evaluation data. Seven are untriaged, for the AI to classify.
  - `nim-15` is a prompt-injection attempt (OWASP LLM01) for the AI safety evaluation.
  - Names are invented and addresses use the reserved `.test` domain.
- **The seed** uses the app's own repository functions, in one transaction, and only touches an empty workspace. Tracking tokens are generated and discarded. No audit events are written, so the audit log keeps recording real actions only.
- **Overview:** an "Open" and "Waiting for customer" count, each linking to that inbox tab.
- **New E2E journeys:**
  - a customer reply reopens a resolved ticket, and the overview counts update;
  - the tracking token never leaks: no Referer from any request the tracking page makes, and absent from the agent inbox, ticket page, audit log and agent API.
- **[ADR-0012](adr/0012-tracking-link.md):** the tracking-link design, the alternatives considered, and its limits. Linked from the accepted risks:
  - **AR-005:** links don't expire and can't be revoked or recovered until email arrives in M8.
  - **M8 note:** the host's access logs may record full URLs.
- **README:** ticketing features and screenshots, a configuration table (including when `TRUST_PROXY_HEADERS` is safe), and the demo data.
- **Tests:**
  - unit: 1 data-consistency suite (+104 tests: status vs. conversation, limits, label coverage);
  - integration: 5 seed tests (contents, times, search, idempotency under concurrent runs, never seeding a workspace that has real tickets);
  - E2E: 2 new journeys.
- **Mutation-checked:**
  - removing the seed's lock let two simultaneous runs create 50 tickets (failed 3 of 3 runs);
  - switching the tracking page back to the site's default referrer policy failed the leak test.

| #   | Finding                                                                                                                                                                                                                         | Action                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 36  | My first seed design reserved a ticket number to lock the workspace, then needed a new "rewind the counter" function to undo it. Too clever for a seed script.                                                                  | Replaced with a transaction-scoped PostgreSQL advisory lock. The mutation check proved it is needed.                                                                                              |
| 37  | Without `no-referrer`, the browser attached the **full private tracking URL** as a Referer to more than a dozen requests from the tracking page (scripts, styles, the reply). Found by the mutation check.                      | No code change; the protection was already in place. It is now proven necessary by a test that fails without it. Recorded in ADR-0012.                                                            |
| 38  | A seed test assigned tickets to someone outside the workspace. The database refused (`ticket_assignee_is_member_fk`, step 1).                                                                                                   | Test fixed. This is the constraint working as designed: tenant rules hold even for scripts that bypass the services.                                                                              |
| 39  | My first README draft said every setting is validated at startup. `CSP_FRAME_ANCESTORS` is not: an invalid value silently becomes `'none'` (no framing).                                                                        | README corrected. The fallback fails safe, so no code change.                                                                                                                                     |
| 40  | With the 25 demo tickets, the inbox looked out of order: it **sorted by creation time but showed last-activity time**. My earlier 5-ticket screenshots couldn't reveal it, because every ticket was created at the same moment. | Rows show "Opened {date}", the value the list is sorted by. A script checked that all 16 dates are in order. A "recently active" sort (its own index and keyset) is a possible later improvement. |
| 41  | Search matches whole words only: "sync" finds "Sync paused" but not "syncing". The index uses PostgreSQL's `simple` configuration (no stemming), which is language-neutral but literal.                                         | Accepted for M3 and documented. Meaning-based search arrives with embeddings (pgvector) in M4/M5; revisit stemming then.                                                                          |

### M3 summary

Customers can submit and follow requests without an account. Agents can triage, reply, write internal notes and change tickets in an inbox. Everything is exposed through a documented REST API on the same services.

- **Tests at the end of M3:** unit 324 (94.9% line coverage), integration 145, smoke 12, E2E 27 (+axe on desktop and mobile).
- **Done-when list:** all items ticked. CI (run 39718487987) and Security (run 39718487964) passed on `8ec626a`, including the dependency audit that had failed during the npm outage.
- **Open items carried to later milestones:** AR-004 (trusted proxy), AR-005 (link expiry and recovery), email notifications (M8), and CAPTCHA if abuse appears (M8).

## M4 · Knowledge base: in progress

Plan: [docs/plans/m4-knowledge-base.md](plans/m4-knowledge-base.md) (approved 2026-10-22).

### Step 1: foundations (2026-10-22)

- Migration 0003: `kb_document`, `kb_document_blob`, `kb_chunk` (pgvector `vector(768)` with an HNSW cosine index, plus a generated English full-text column) and `ai_usage`.
- A tenant-scoped repository with 20 integration tests (3 mutations, all caught).
- `AI_PROVIDER` (`mock` or `gemini`) is required in production. Verified: the production server refuses to start without it.

### Step 2: ingestion core (2026-10-22)

- **Upload validation (OWASP File Upload Cheat Sheet):**
  - extension allowlist; the browser's Content-Type is ignored;
  - `%PDF-` signature for PDFs; strict UTF-8 with no NUL bytes for text, and no PDF disguised as text;
  - display-safe file names (path, control and bidi characters removed).
- **Normalization:** removes invisible zero-width and bidi characters that could hide instructions from a reviewer (T9).
- **Heading-aware chunker:** about 500 tokens per chunk with about 15% whole-sentence overlap; code fences kept intact.
- **Embedders:**
  - Gemini (`gemini-embedding-2`, 768 dimensions, Google's retrieval prefixes, batches of 100, one call at a time, timeout, temporary/permanent error mapping);
  - an offline mock (feature hashing).
- **PDF text extraction** runs in a `worker_thread` with a 256 MB heap cap and a 30-second kill.
- **Tests:**
  - 91 new unit tests (unit total 419, 97.2% line coverage; every new KB module at 100% lines);
  - PDF fixtures are generated in code (`tests/support/pdf.ts`): valid, 50/51 pages, password-protected (RC4), scanned, truncated, a PNG renamed `.pdf`, a PDF renamed `.txt`;
  - the Gemini adapter is tested against a fake `fetch`: exact URL, prefixes, dimensions, key in a header and never in the URL.
- **Mutation-checked:** 16 deliberate breaks (timeout, heap cap, page limit, signature, polyglot, UTF-8, path stripping, bidi removal, overlap, headings, fences, prefixes, parallelism, 429 handling, character cap, encryption). **All 16 caught.**

| #   | Finding                                                                                                                                                                                                                                                                     | Resolution                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 42  | My design notes planned to pass PDF.js `isEvalSupported: false` (the CVE-2024-4367 mitigation). The option **no longer exists** in PDF.js 6.4: grep finds no `eval(` or `new Function` anywhere in unpdf 1.9.1's bundled PDF.js. The flag would have been silently ignored. | The thread passes only options that exist (fonts, XFA and streaming off, images capped at 16 MP). The checked fact is recorded in `pdf/thread.ts`.                                                                           |
| 43  | **Chunk overlap silently disappeared** for long paragraphs: they were pre-packed into almost-full pieces, so "overlap + piece" never fit. Found by a test that checked overlap actually happens.                                                                            | One packer now works on sentence-sized units and adds the overlap itself. A mutation that removes the overlap fails the test.                                                                                                |
| 44  | The Gemini SDK reports some bad answers itself (a missing vector raises `InvalidResponseDataError`; a malformed 200 body raises an `APICallError` with status 200). My first mapping called them "temporary" or "rejected".                                                 | Both are mapped to `embedding_invalid` (permanent), so the job doesn't retry a response that will never be valid.                                                                                                            |
| 45  | With the heap cap removed (mutation test), the memory-hog thread grew until the OS **SIGKILLed the whole test process**, as it would kill the production worker. With the cap, only the thread dies and the document gets a clear `pdf_too_complex` reason.                 | The cap stays. The 256 MB thread heap assumes a container with about 1 GB of RAM: size the worker accordingly in M8.                                                                                                         |
| 46  | Node 24 runs TypeScript files directly (type stripping), including as `worker_thread` scripts. The PDF thread therefore stays type-checked and linted instead of being a hand-written `.mjs`.                                                                               | An ESLint rule allows only Node built-ins, `unpdf` and type-only imports in `pdf/thread.ts`. Verified by adding a forbidden import, which failed lint. The production bundle (step 3) must ship the thread as its own entry. |

### Step 3: background jobs and worker (2026-10-22)

- **Job queue (pg-boss on the same PostgreSQL, ADR-0005):**
  - `kb.ingest`: 3 retries with exponential backoff (30 s up to 10 min), a 10-minute expiry and a 30-second heartbeat;
  - failed jobs go to a dead-letter queue, `kb.ingest.dead`, whose handler marks the document `failed` so nothing stays "processing" forever.
- **Transactional enqueue:** the job is inserted in the same database transaction as the document (`fromDrizzle(tx)`). If the upload rolls back, no job exists; if it commits, the job is guaranteed to exist.
- **Idempotent handler:**
  - the document row is locked; finished or deleted documents are skipped;
  - embedding runs with **no transaction open**;
  - after embedding, the row is re-checked before saving, so a document deleted or re-queued meanwhile is not overwritten;
  - AI usage is recorded even when the result is discarded, because the call still cost money.
- **One owner for each schema change:** the release step (`node .build/migrate.mjs`) applies SQL migrations **and** installs or updates the queues. The web app and worker never change the schema.
- **Worker process:**
  - `pnpm worker` from source, or `node .build/worker.mjs` in the image (esbuild bundle, with the PDF thread as a separate bundle entry);
  - graceful shutdown on SIGTERM/SIGINT (in-flight jobs get 30 s), then the database pool closes.
- **Tests:**
  - 19 integration tests against real PostgreSQL, including two copies of one job running at once, deletion mid-embedding, retries until the final attempt, the dead-letter path, and an end-to-end run through pg-boss;
  - 16 unit tests (payload validation, queue settings, worker/database settings);
  - **8 deliberate breaks, all caught:** no re-check after embedding (×2), final attempt ignored, permanent errors retried, finished documents re-processed, an off-by-one in the final-attempt check, enqueue outside the transaction, unvalidated payloads.
- **Smoke test against the built worker** (`tests/smoke/worker.test.ts`): Markdown → `ready`; a 2-page PDF through the **bundled** PDF thread → `ready` with 2 pages; a password-protected PDF → `failed: pdf_encrypted`. It runs in CI twice: against the bundle, and inside the Docker image.
- **Gate (local):** lint, typecheck, format; unit 435 (97.3% lines); integration 184; smoke 15; production build; E2E 27. `pnpm audit --prod` is clean; the full audit shows only AR-001 (dev tools).

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                               | Fix                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 47  | A scratch experiment showed pg-boss `send()` refuses to run on an instance that was never started, **even with a transaction adapter** ("Database not opened. Call start()").                                                                                                                                                                                                                                         | The web app starts a light enqueue-only instance: no maintenance, no migrations, at most 2 connections.                                                                                                  |
| 48  | pg-boss rejects a queue whose dead-letter queue does not exist yet, and rejects `retryDelayMax` without exponential backoff. My first test override hit the second (18/19 passed).                                                                                                                                                                                                                                    | Install order is fixed in code (dead-letter queue first), with a unit test; test overrides omit `retryDelayMax`.                                                                                         |
| 49  | The worker would have needed the **login secrets** to start: the only settings loader required `BETTER_AUTH_SECRET`. A background job processor should not hold them (least privilege).                                                                                                                                                                                                                               | Separate settings for the worker and the database layer. CI starts the worker before the auth secret even exists, and checks that it exits with code 1 when `DATABASE_URL` or `AI_PROVIDER` is missing.  |
| 50  | **Pre-existing bug:** `docker compose --profile full up` would have stopped at once. The `app` service lacked `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (required since M2) and `AI_PROVIDER` (since M4 step 1). Docker cannot run in my sandbox, and CI tests the image with `docker run`, not Compose. While fixing it I nearly added `GEMINI_API_KEY: ${GEMINI_API_KEY:-}`, but an empty key is rejected (verified). | The secret is required from the shell with a clear error; `AI_PROVIDER` defaults to `mock`; a `worker` service was added. **Still unverified:** Compose itself has not been run; see "Not yet verified". |
| 51  | The image's `HEALTHCHECK` probes the web port, so a worker container from the same image would be reported "unhealthy" and could be restarted in a loop.                                                                                                                                                                                                                                                              | The worker runs with the health check disabled (Compose `disable: true`, CI `--no-healthcheck`). A real worker health signal is planned for M8.                                                          |

**Not yet verified:** `docker compose --profile full up` (needs Docker on a laptop). The same image, commands and settings are exercised by the CI docker job.
