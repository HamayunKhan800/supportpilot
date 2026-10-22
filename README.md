# SupportPilot

AI-assisted customer support with **grounded, cited answers** and a **human in the loop**.

> 🚧 **Status: M0–M3 complete: foundation, accounts, workspaces, roles and ticketing.** AI features arrive in M4–M6. See the [roadmap](docs/00-research-and-plan.md#5-implementation-roadmap-one-verifiable-milestone-at-a-time).

## Tech stack

TypeScript (strict) · Next.js 16 (App Router) · React 19 · Node.js 24 LTS · PostgreSQL 17 + pgvector · Drizzle ORM · Better Auth · Tailwind CSS + shadcn/ui · Zod · pino · Vitest · Playwright + axe · Docker · GitHub Actions.
Reasons for each choice are in [`docs/adr/`](docs/adr/).

## What works today (M3)

**Ticketing**

- A public **customer portal** per workspace (`/p/{slug}`). Customers need no account: they get a **private tracking link** to follow the conversation and reply. The link is a 256-bit random token, only its hash is stored, and it is kept out of referrers, caches, search engines and logs ([ADR-0012](docs/adr/0012-tracking-link.md)).
- An **agent inbox** with status tabs and counts, full-text search (`#12`, `-exclude`), filters, and keyset paging. Filters live in the URL.
- A **ticket page** with the conversation, public replies vs **internal notes**, and status, priority, category and assignee. Internal notes never reach customers (tested at service, API and browser level).
- Ticket lifecycle rules (`closed` is final, a customer reply reopens a resolved ticket). **Concurrent edits are detected**, so nobody overwrites a colleague's change. Every change is in the audit log.
- Portal abuse controls: rate limits per IP, per workspace and per ticket, a honeypot, and size limits.
- A documented **REST API** (OpenAPI 3.1) on the same services, with cross-workspace access tests for every route.

**Foundation**

- Email + password accounts (NIST SP 800-63B-4 password rules, optional breached-password check), database sessions, sign-out everywhere on password change.
- Multi-tenant **workspaces**: create, switch, invite by single-use 7-day link, change roles, remove members. Roles **owner / admin / agent** are enforced on the server for every action. Cross-workspace access is tested.
- Append-only **audit log** of membership and ticket changes.
- Strict per-request **nonce Content Security Policy** (no inline scripts), rate limiting, CSRF/origin checks.
- Accessible, responsive UI. Automated axe scans find 0 serious issues on desktop and mobile.

| Agent inbox                                           | Ticket with an internal note                           |
| ----------------------------------------------------- | ------------------------------------------------------ |
| ![Agent inbox](docs/screenshots/m3-inbox-desktop.png) | ![Ticket page](docs/screenshots/m3-ticket-desktop.png) |

| Customer portal (phone)                                    | Customer tracking page (phone)                                 | Members (owner view)                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| ![Portal form](docs/screenshots/m3-portal-form-mobile.png) | ![Tracking page](docs/screenshots/m3-tracking-page-mobile.png) | ![Members page](docs/screenshots/m2-members-owner.png) |

## Quick start (local)

Prerequisites: Node.js 24 (`.nvmrc`), pnpm via Corepack (`corepack enable`), Docker.

```bash
cp .env.example .env.local          # dev-only defaults
docker compose up -d db             # PostgreSQL 17 + pgvector (creates the test DB too)
pnpm install --frozen-lockfile
pnpm db:migrate                     # apply SQL migrations
pnpm dev                            # http://localhost:3000
DEMO_PASSWORD='choose a long passphrase' pnpm db:seed-demo   # optional demo workspace
```

The demo seed creates "Nimbus Cloud Storage" with `owner@`, `admin@` and `agent@demo.supportpilot.dev`, all using your `DEMO_PASSWORD`, plus **25 synthetic tickets**. Every person in them is invented, and addresses use the reserved `.test` domain. The tickets carry correct category and priority labels and double as the evaluation set for AI triage (M5/M6). Running the seed again is safe: it only adds tickets to an empty workspace.

Run the production image locally instead: `docker compose --profile full up --build`.

## Scripts

| Command                           | What it does                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm check`                      | lint + typecheck + format check + unit tests                                                 |
| `pnpm test:coverage`              | unit tests with coverage thresholds (80% lines/functions)                                    |
| `pnpm test:integration`           | tests against real PostgreSQL (`TEST_DATABASE_URL`)                                          |
| `pnpm test:smoke`                 | HTTP checks against a running server (`SMOKE_BASE_URL`)                                      |
| `pnpm test:e2e`                   | Playwright + axe against the production build (run `pnpm build` and `pnpm db:migrate` first) |
| `pnpm build`                      | production build (needs **no** runtime secrets)                                              |
| `pnpm db:generate` / `db:migrate` | create / apply migrations                                                                    |

## Configuration

All settings are environment variables. Most are validated at startup (`src/server/platform/env.ts`), and the server exits if one is invalid. `.env.example` has local defaults.

| Variable                                                          | Default                            | Purpose                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                    | (required)                         | PostgreSQL 17 with pgvector                                                                                                                                                                                                                                    |
| `BETTER_AUTH_SECRET`                                              | (required)                         | Session signing secret, at least 32 characters (`openssl rand -base64 32`)                                                                                                                                                                                     |
| `BETTER_AUTH_URL`                                                 | (required)                         | Public URL of the app. Also the only origin allowed to send cookie-authenticated writes                                                                                                                                                                        |
| `AUTH_TRUSTED_ORIGINS`                                            | none                               | Extra allowed origins, comma-separated (e.g. a preview URL)                                                                                                                                                                                                    |
| `AUTH_RATE_LIMIT_ENABLED`                                         | `true`                             | Sign-in / sign-up rate limits. Disable only in tests                                                                                                                                                                                                           |
| `PORTAL_RATE_LIMIT_ENABLED`                                       | `true`                             | Portal submission and reply limits. Disable only in tests                                                                                                                                                                                                      |
| `AUTH_PASSWORD_BREACH_CHECK`                                      | `true`                             | Have I Been Pwned range check on new passwords. Fails closed: if the API can't be reached, the password is refused                                                                                                                                             |
| `TRUST_PROXY_HEADERS`                                             | `false`                            | Read the client IP from `X-Forwarded-For` for per-IP portal limits. **Enable only behind a proxy that overwrites that header.** Otherwise anyone can fake their IP. While off, all clients share one per-IP bucket ([AR-004](docs/security/accepted-risks.md)) |
| `CSP_FRAME_ANCESTORS`                                             | `'none'`                           | Origins allowed to embed the app in a frame. Read by the proxy: an invalid value falls back to `'none'` (no framing) instead of stopping the server                                                                                                            |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`                       | none                               | Optional GitHub sign-in                                                                                                                                                                                                                                        |
| `AI_PROVIDER`                                                     | `mock` (must be set in production) | `gemini` for real embeddings, `mock` for deterministic offline embeddings (tests, local work). Production must choose explicitly, so a deployment never silently runs on fake embeddings                                                                       |
| `GEMINI_API_KEY`                                                  | none                               | Google AI Studio key, required when `AI_PROVIDER=gemini`. Free-tier inputs may be used by Google to improve its products: demo data only                                                                                                                       |
| `LOG_LEVEL`, `DATABASE_POOL_MAX`, `DATABASE_STATEMENT_TIMEOUT_MS` | `info`, `10`, `10000`              | Logging and database tuning                                                                                                                                                                                                                                    |

## Operational endpoints

| Endpoint          | Purpose                                                                  |
| ----------------- | ------------------------------------------------------------------------ |
| `GET /api/health` | liveness: process is serving (does not touch DB)                         |
| `GET /api/ready`  | readiness: DB reachable. Returns `503` + RFC 9457 problem details if not |

The server **refuses to start** (exit 1) when configuration is invalid. Every response carries an `x-request-id` that matches the structured JSON logs.

## REST API (`/api/v1`)

The machine-readable contract is served at **`GET /api/v1/openapi.json`** (OpenAPI 3.1), generated from the same Zod schemas that validate requests. Errors use RFC 9457 Problem Details.

| Endpoint                                 | Who                         |
| ---------------------------------------- | --------------------------- |
| `POST /api/v1/portal/{slug}/tickets`     | public (rate limited)       |
| `GET /api/v1/portal/t/{token}`           | customer with tracking link |
| `POST /api/v1/portal/t/{token}/messages` | customer with tracking link |
| `GET /api/v1/tickets`                    | workspace member            |
| `GET` / `PATCH /api/v1/tickets/{id}`     | workspace member            |
| `POST /api/v1/tickets/{id}/messages`     | workspace member            |

Agent endpoints use the browser session and accept writes only from the app's own origin.

## Quality gates (CI)

Lint (incl. accessibility rules, zero warnings) · strict typecheck · Prettier · unit tests + coverage · integration tests on PostgreSQL + pgvector · production build + smoke tests · Playwright E2E + axe accessibility scans (fail on any CSP violation) · fail-fast config check · Docker build + container smoke (non-root, HEALTHCHECK) · CodeQL · gitleaks · dependency review · `pnpm audit` (production deps blocking). All actions are pinned to commit SHAs. Dependabot keeps them current.

## Documentation

| Doc                                                       | Contents                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| [00 · Research & plan](docs/00-research-and-plan.md)      | Market research with sources, stack choice, roadmap                  |
| [01 · Requirements](docs/01-requirements.md)              | Roles, functional & non-functional requirements, acceptance criteria |
| [02 · Architecture](docs/02-architecture.md)              | System design, data model, API contract, key flows                   |
| [03 · Threat model](docs/03-threat-model.md)              | STRIDE, OWASP Top 10:2025 and OWASP LLM Top 10 mapping               |
| [04 · AI evaluation plan](docs/04-ai-evaluation-plan.md)  | Golden dataset, metrics, targets                                     |
| [ADRs](docs/adr/)                                         | Architecture decision records                                        |
| [Accepted risks](docs/security/accepted-risks.md)         | Known limitations with mitigations and a revisit date                |
| [M3 plan](docs/plans/m3-ticketing.md)                     | Ticketing design decisions D1–D10 and the "done when" list           |
| [Milestone log](docs/milestones.md)                       | What was built and verified in each milestone                        |
| [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) | Workflow, AI-assisted development policy, vulnerability reporting    |

## License

[MIT](LICENSE)
