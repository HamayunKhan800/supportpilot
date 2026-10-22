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

## M3 · Ticketing: in progress

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
