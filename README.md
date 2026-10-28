# SupportPilot

AI-assisted customer support. SupportPilot triages new tickets and drafts replies that **cite the help-centre articles they are based on**. **A person approves every reply** before a customer sees it.

[![CI](https://github.com/HamayunKhan800/supportpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/HamayunKhan800/supportpilot/actions/workflows/ci.yml)
[![Security](https://github.com/HamayunKhan800/supportpilot/actions/workflows/security.yml/badge.svg)](https://github.com/HamayunKhan800/supportpilot/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[![Open the live demo](https://img.shields.io/badge/Open_the_live_demo-1a1a1d?style=for-the-badge)](https://uvum4mohfhovga35knouyzhqmi0wkxnr.lambda-url.ap-southeast-2.on.aws)

> Live on AWS Lambda with real Gemini models: sign in with a [public demo account](#live-demo). It also runs locally with a few commands and a built-in offline AI, no API key needed ([Quick start](#quick-start-local)). Open-source portfolio project, built one tested milestone at a time. **Short on time?** Read the [case study](docs/case-study.md).

## At a glance

- **What it is:** a multi-tenant help desk. AI labels each new ticket and drafts replies from the company's own help articles, with citations. A person approves every reply.
- **AI quality, measured on real Gemini models:** the right article in the top 5 for 99.1% of 110 questions, the right triage category for 94.0% of 150 tickets, 100% of 133 citations pointing at a real passage, and all 20 prompt-injection attacks resisted ([evaluation](#evaluation-real-gemini-models)).
- **Tested:** 1,444 unit tests (96% of lines covered), 565 integration tests on real PostgreSQL and 130 browser tests with accessibility scans in both themes. CI runs them all on every push.
- **Security:** self-reviewed against OWASP ASVS 5.0 Level 2: 183 requirements pass, 9 pass in part and 2 fail as documented accepted risks. No High or Critical findings ([security](#security)).
- **Deployed as code:** Terraform on AWS Lambda (Sydney) with Neon PostgreSQL. After CI passes, one approval releases a new version with database migrations and smoke tests; a one-click rollback was tested both ways ([infrastructure](infra/README.md)).
- **Built with AI coding assistants, checked by tests and official docs** ([policy](CONTRIBUTING.md#ai-assisted-development-policy)).

## Demo (1 minute)

![A customer sends a request; Gemini labels it within seconds; the agent generates a draft citing two help articles, checks it and approves it; the customer sees the reply on their tracking page](docs/demo/walkthrough.gif)

<sub>Recorded on the live demo on 28 October 2026 with real Gemini models, at real speed, no sound (66 seconds; the draft takes about 18 seconds to write). The captions and the orange highlights were added for the recording. Sharper copy: [walkthrough.mp4](docs/demo/walkthrough.mp4) (1 MB).</sub>

![A live ticket in SupportPilot: the customer's message, an AI draft citing two help articles, and the AI triage card](docs/screenshots/app/ticket-light.png)

<sub>A ticket on the live demo, 28 October 2026. Real Gemini models labelled it (how-to, high priority, 95% confident, so applied automatically) and wrote the draft. Every citation was checked against the passages the model was given. The agent still reviews it: the customer emptied the bin on their laptop, which may not be the Nimbus trash the draft talks about. Screenshots are from the live demo unless a caption says otherwise.</sub>

## Contents

- [At a glance](#at-a-glance) · [Demo (1 minute)](#demo-1-minute) · [Live demo](#live-demo)
- [What it does](#what-it-does)
- [Engineering highlights](#engineering-highlights)
- [Screenshots](#screenshots)
- [Evaluation (real Gemini models)](#evaluation-real-gemini-models)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Security](#security)
- [Testing and CI](#testing-and-ci)
- [Limitations](#limitations) · [What I'd do next](#what-id-do-next)
- [Roadmap](#roadmap)
- [Quick start (local)](#quick-start-local) · [Scripts](#scripts) · [Configuration](#configuration) · [API](#operational-endpoints)
- [Documentation](#documentation)

## Live demo

**https://uvum4mohfhovga35knouyzhqmi0wkxnr.lambda-url.ap-southeast-2.on.aws**

| Sign in as                    | Try                                                  |
| ----------------------------- | ---------------------------------------------------- |
| `owner@demo.supportpilot.dev` | everything in the workspace, including the audit log |
| `admin@demo.supportpilot.dev` | the knowledge base and AI settings, plus the inbox   |
| `agent@demo.supportpilot.dev` | the inbox: AI triage, cited drafts, replies          |

Password for all three: `nimbus-demo-R-6ARSwgV5Nb`. It is public on purpose. The demo accounts can't change their password, sign others out, invite or remove members, or link their own Google or GitHub account; anything else a visitor changes, such as settings or articles, is undone by the daily reset. To see the customer side, send a ticket from the [Nimbus support form](https://uvum4mohfhovga35knouyzhqmi0wkxnr.lambda-url.ap-southeast-2.on.aws/p/nimbus-demo), then find it in the inbox with its AI triage.

- **Everything resets daily** at 00:05 Pacific time (12:05 PKT, 13:05 PKT in winter): visitor tickets are removed and the demo workspace is rebuilt.
- **The AI is real** (Gemini free tier) and limited to 200 calls and 800 embeddings a day for the whole demo. When a limit is reached, tickets wait for a person instead, as they would if the AI were down.
- **The first page can take a few seconds:** the app scales to zero when nobody uses it, and the first request starts it again.

How it runs: [ADR-0021](docs/adr/0021-aws-lambda-deployment.md) · [runbook](docs/runbook.md) · [infrastructure](infra/README.md).

## What it does

| Who                     | What they get                                                                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Customers**           | A support form for each company (`/p/{slug}`) with no account needed, and a private tracking link to follow the conversation and reply.                                                                                          |
| **Agents**              | An inbox with search, filters and keyboard shortcuts. Each new ticket gets an AI category and priority. A cited AI draft can be edited, previewed exactly as the customer will see it, and sent only when the agent approves it. |
| **Admins and owners**   | A knowledge base (Markdown, text or PDF) that drafts are grounded in. AI settings for an on/off switch, a monthly budget, the auto-apply threshold and categories. Also members, roles, invites and an audit log.                |
| **The team running it** | Usage analytics, an evaluation dashboard with 95% uncertainty ranges, structured logs, OpenTelemetry traces and Sentry error reports. None of these contain customer text.                                                       |

## Engineering highlights

- **Grounded or refused.** A draft is built only from the 5 best-matching help-centre passages. Every `[n]` citation is checked against the passages the model was actually given, and invalid ones are removed before an agent sees the draft. If nothing relevant exists, the draft is **refused**: either with no AI call at all (no passage scores high enough) or by the model itself.
- **Human in the loop by design.** Nothing is sent automatically. Triage applies a label only when the model is confident enough **and** no person has set that field, so it never overwrites a human. Everything else is marked _Needs review_.
- **Decisions from measurements.** A 420-item evaluation on real Gemini models reports 95% intervals, and the defaults follow the data. One example: at the old auto-apply threshold of 0.7, all 19 wrong triage categories were applied automatically. The default is now 0.95, where 13 of the 19 are caught ([finding 1](docs/eval/m6-baseline.md#findings)). Other examples: hybrid search was dropped because vector search alone ranked better, and the refusal score was set at 0.62.
- **One gateway for every model call.** It enforces a per-workspace budget, a deployment-wide daily cap (one atomic database update, so parallel workers can't overshoot it), timeouts and a circuit breaker per model. It switches to a fallback model when the draft model is overloaded, but never reroutes a 429, so rate limits are respected. Tokens, estimated cost and latency are recorded for every call; prompts and answers are never logged.
- **Prompt-injection defences** (OWASP LLM Top 10 2026). Ticket text and articles are treated as untrusted data: hidden characters are stripped and flagged, and output is rendered as plain text. Unknown links and leaked prompt text are flagged. A 20-case attack set (12 in tickets, 8 in poisoned help articles) runs in CI.
- **Multi-tenant and secure by default.** Roles (owner / admin / agent) are checked on the server for every action, and every route has cross-workspace access tests. Other defences: a per-request nonce Content Security Policy, rate limits, and conflict detection for concurrent edits.
- **Feels live, without a sync engine.** Ticket details save the moment they change, with Undo, and a refused change is put back and explained. Open pages check for news every 15 seconds while visible ("New ticket #26", "Casey replied"), but never while someone is typing. Drafts stream in, and losing the connection is announced. This uses plain polling and CSS only: no animation library and no extra dependencies. All motion stays under 300 ms and switches off when the device asks for reduced motion ([plan and decisions](docs/plans/feedback-and-motion.md)).
- **Designed, accessible and fast.** It has a small design system built on its own tokens (light and dark, following the device setting) and keyboard-first navigation with a command palette. axe finds **0 violations** on every page in both themes. The landing page scores **100** in all four Lighthouse categories on desktop. On Lighthouse's simulated slow phone it scores 83–89 for performance across three runs (others 100): the headline is the first paint (0.3 s unthrottled), and the score is held back by hydrating a long page.

## Screenshots

![Opening a ticket, generating a cited AI draft that streams in, then changing the priority and undoing it from the confirmation](docs/screenshots/app/feedback-demo.gif)

<sub>Recorded from the app with the offline mock AI (14 seconds, real timing). The page data was slowed by 0.7 s so the progress bar is visible, as it would be on a slow connection.</sub>

| Agent inbox                                                                | Inbox, dark theme                                                     |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| ![Agent inbox](docs/screenshots/app/inbox-light.png)                       | ![Agent inbox in the dark theme](docs/screenshots/app/inbox-dark.png) |
| **Overview: today's requests, what needs you, recent activity**            | **Sign-in**                                                           |
| ![Overview](docs/screenshots/app/overview-light.png)                       | ![Sign-in](docs/screenshots/app/sign-in-light.png)                    |
| **Triage left for a person (confidence 90%, below 95%)**                   | **Ticket with a cited draft, dark theme**                             |
| ![Triage waiting for review](docs/screenshots/app/ticket-review-light.png) | ![Ticket in the dark theme](docs/screenshots/app/ticket-dark.png)     |
| **Evaluation dashboard (the real Gemini run, from a local database)**      | **Usage analytics**                                                   |
| ![Evaluation dashboard](docs/screenshots/app/evaluation-light.png)         | ![Usage analytics](docs/screenshots/app/analytics-light.png)          |
| **Knowledge base**                                                         | **AI settings and this month's usage**                                |
| ![Knowledge base](docs/screenshots/app/knowledge-light.png)                | ![AI settings](docs/screenshots/app/settings-light.png)               |
| **Command palette (Ctrl/⌘ K)**                                             | **Landing page**                                                      |
| ![Command palette](docs/screenshots/app/palette-light.png)                 | ![Landing page](docs/screenshots/app/landing-light.png)               |
| **Customer support form**                                                  | **Customer tracking page**                                            |
| ![Support form](docs/screenshots/app/portal-light.png)                     | ![Tracking page](docs/screenshots/app/tracking-light.png)             |

| Inbox on a phone                                          | Ticket on a phone                                           | Landing page on a phone                                       |
| --------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| ![Inbox on a phone](docs/screenshots/app/inbox-phone.png) | ![Ticket on a phone](docs/screenshots/app/ticket-phone.png) | ![Landing on a phone](docs/screenshots/app/landing-phone.png) |

## Evaluation (real Gemini models)

One complete run of 420 test items on the Gemini free tier, finished on 24 October 2026, plus a second triage run that compared two prompts. The runs used `gemini-3.5-flash-lite` for triage and grading, and `gemini-3.8-flash` for drafts with `gemini-3.5-flash-lite` as the fallback. The ranges are 95% Wilson intervals. Full report, method and raw results: [`docs/eval/m6-baseline.md`](docs/eval/m6-baseline.md).

| What is measured                                                            | Result        | 95% range               | Items | Target |
| --------------------------------------------------------------------------- | ------------- | ----------------------- | ----- | ------ |
| Right article in the top 5 search results (recall@5)                        | 99.1%         | 95.0–99.8%              | 110   | ≥ 90%  |
| Triage category correct (prompt v2)                                         | 94.0%         | 89.0–96.8%              | 150   | ≥ 85%  |
| Triage priority exact / within one level (prompt v2)                        | 91.3% / 99.3% | 85.7–94.9% / 96.3–99.9% | 150   | none   |
| Citations pointing at a passage the model was given                         | 100%          | 97.2–100%               | 133   | 100%   |
| Unanswerable questions declined                                             | 100%          | 88.6–100%               | 30    | ≥ 90%  |
| Answerable questions wrongly declined                                       | 1.8%          | 0.5–6.4%                | 110   | ≤ 10%  |
| Prompt-injection attacks resisted                                           | 100%          | 83.9–100%               | 20    | 100%   |
| Draft supported by its sources (**AI-graded, not checked against a human**) | 99.1%         | 94.8–99.8%              | 106   | none   |

| Speed                       | Typical (p50) | Slow (p95) |
| --------------------------- | ------------- | ---------- |
| Triage                      | 1.3 s         | 17.5 s     |
| Draft, first text on screen | 0.9 s         | 9.3 s      |
| Draft, complete             | 13.7 s        | 28.5 s     |

**Triage prompt v1 vs v2.** The app now uses triage prompt v2, which spells out the labelling rules. It was written and frozen before it was measured, and the rule for adopting it was fixed in advance: better on category or priority with p < 0.025 (exact McNemar test on the same 150 tickets), and worse on neither. Priority went from 73.3% to 91.3% (p < 0.001) and category from 87.3% to 94.0% (p = 0.031, which on its own does not pass the bar). v2's rules come from the same rubric used to label the tickets, so part of the gain may be the prompt matching the labeller. Details: [`docs/eval/triage-v1-v2.md`](docs/eval/triage-v1-v2.md).

**Cost:** about **$0.18 for the whole 420-item run** at paid-tier prices (roughly $0.0005 per draft and $0.0003 per triage with prompt v1), and $0 on the free tier. Prompt v2 is longer, so a triage costs about $0.0006.

**Read with care.** Every point estimate meets its target. For two of them, though, the lower end of the range is below target: refusals (88.6 vs 90) and injection (83.9 vs 100). The samples are small, and the data is synthetic (a 35-article help centre for a made-up company). The main draft model often timed out or was overloaded on the free tier, so the fallback model wrote 132 of the 140 drafts. More caveats are under [Limitations](#limitations). CI runs the same evaluation on every push with the deterministic mock AI, and fails if a result drops below its floor. The Gemini run is started by hand, behind a protected GitHub environment.

## Architecture

```mermaid
flowchart LR
  CU["Customer<br/>support form + tracking link"] -->|HTTPS| FURL
  AG["Agent / admin<br/>workspace app"] -->|HTTPS| FURL
  subgraph AWS["AWS Sydney: one container image, two Lambda functions"]
    FURL["Function URL<br/>HTTPS, streamed responses"] --> WEB
    WEB["web function<br/>Next.js 16: UI, REST API, auth"]
    WK["worker function<br/>pg-boss jobs: triage, ingestion<br/>+ migrations, daily demo reset"]
    SCH["EventBridge Scheduler<br/>daily 00:05 Pacific"]
    SSM[("SSM Parameter Store<br/>secrets, read at cold start")]
  end
  WEB -->|"async invoke: wake when a job is queued"| WK
  SCH -->|seed-reset| WK
  SSM -.-> WEB
  SSM -.-> WK
  WEB --> DB[("Neon PostgreSQL 18 + pgvector<br/>data, job queue, vectors")]
  WK --> DB
  WEB -->|"through the AI gateway"| LLM[["Gemini API<br/>or offline mock"]]
  WK --> LLM
  GH["GitHub Actions<br/>CI, then an approved deploy:<br/>migrations + smoke tests"] -.->|"Terraform, release, rollback"| AWS
```

- **A modular monolith:** one codebase and one image, deployed as two Lambda functions, `web` and `worker` (locally, two Node processes). Module boundaries come from the folder structure and lint rules (route handlers call services and may not import the database layer). There are no network hops between modules.
- **Serverless and idle-friendly:** both functions scale to zero. When the web function queues a job, it wakes the worker with an asynchronous invoke, and the worker drains the queue and stops. A schedule rebuilds the demo once a day. Why Lambda and what it trades away: [ADR-0021](docs/adr/0021-aws-lambda-deployment.md).
- **PostgreSQL does three jobs:** application data, the job queue (pg-boss) and vector search (pgvector). That leaves one system to run and back up.
- **How a draft is made:**
  1. An agent clicks _Generate draft_.
  2. The top 5 passages are found by meaning (`gemini-embedding-2`, pgvector). If the best passage scores below 0.62, the draft is refused with no AI call.
  3. The model streams a reply with `[n]` citations.
  4. Citations, links, hidden characters and leaked prompt text are checked.
  5. The agent edits, previews and approves the reply. It is sent as a public reply and recorded in the audit log.
- **When a ticket arrives:** a background job labels it. The label is applied only if confidence ≥ the workspace threshold and no person has set that field. Otherwise it shows as _Needs review_.

More detail: [architecture](docs/02-architecture.md) (data model, API contract, flows) and [21 architecture decision records](docs/adr/).

## Tech stack

| Area       | Choice                                                                      | Why                                                                                      |
| ---------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Language   | TypeScript (strict), Node.js 24 LTS                                         | One language from database to browser; the most-used language on GitHub (Octoverse 2025) |
| Web        | Next.js 16 (App Router), React 19                                           | Server rendering, route handlers and streaming in one framework                          |
| Data       | PostgreSQL + pgvector (17 locally, 18 on Neon), Drizzle ORM, SQL migrations | Relational data, vectors and the job queue in one database                               |
| Auth       | Better Auth                                                                 | Database sessions, organisations and roles; NIST SP 800-63B-4 password rules             |
| AI         | Vercel AI SDK, Google Gemini; a deterministic mock                          | Structured output and streaming; the mock keeps tests and local work offline and free    |
| UI         | Tailwind CSS 4, shadcn/ui on Base UI primitives, Geist fonts (self-hosted)  | Accessible primitives on a small design system of its own tokens                         |
| Validation | Zod                                                                         | One schema for API input, AI output and environment variables                            |
| Quality    | Vitest, Playwright + axe, ESLint, Prettier                                  | Unit, integration on a real database, browser tests with accessibility scans             |
| Ops        | AWS Lambda, Terraform, Docker, GitHub Actions, pino, OpenTelemetry, Sentry  | Scales to zero, infrastructure as code, pinned CI, logs and traces without customer data |

The research behind these choices, with sources: [docs/00](docs/00-research-and-plan.md).

## Security

- **Accounts:**
  - Email and password following NIST SP 800-63B-4, with an optional breached-password check that fails closed.
  - Optional "Continue with Google / GitHub". A provider sign-in joins an existing account only when both sides have verified the email ([ADR-0020](docs/adr/0020-account-emails-and-social-sign-in.md)).
  - When email is configured: password reset by single-use link (OWASP) and email verification by 6-digit code, with tokens and codes stored hashed and the same answers for known and unknown emails.
  - Database sessions that end 7 days after sign-in; the Account page lists your signed-in devices and can sign them out. Changing or resetting your password signs you out everywhere.
  - Passwords hashed with scrypt at an OWASP setting; sign-in limited per IP.
- **Authorisation:**
  - Owner / admin / agent roles are checked on the server for every action.
  - Every tenant query is scoped by workspace, with cross-workspace tests for each route.
- **Web:**
  - A per-request nonce Content Security Policy (no inline scripts), with E2E tests failing on any CSP violation.
  - Origin checks on writes.
  - Rate limits on sign-in and the portal; a honeypot on the support form.
- **Customer links:**
  - Tracking links are 256-bit random tokens, and only their hash is stored.
  - They are kept out of referrers, caches, search engines and logs ([ADR-0012](docs/adr/0012-tracking-link.md)).
- **File uploads (OWASP rules):**
  - Extension allowlist plus a content check, and size and quota limits.
  - Files are never served back.
  - PDFs are parsed in a sandboxed thread with a memory cap and a 30-second kill.
- **AI:**
  - Prompt-injection defences and a 20-case attack set in CI.
  - Output rendered as plain text.
  - Prompts and answers are not logged.
  - Telemetry exports only allowlisted metadata.
- **Supply chain:**
  - CodeQL, gitleaks, dependency review, `pnpm audit` and an OWASP ZAP baseline scan in CI.
  - A CycloneDX SBOM (list of production dependencies) saved by every CI run, and fix time frames in [SECURITY.md](SECURITY.md).
  - All GitHub Actions pinned to commit SHAs; Dependabot.

Threat model: [docs/03](docs/03-threat-model.md) (STRIDE, OWASP Top 10:2025, OWASP LLM Top 10 2026). Known gaps with mitigations and revisit dates: [accepted risks](docs/security/accepted-risks.md). Reporting a vulnerability: [SECURITY.md](SECURITY.md).

**Security review (M7).** Checked against [OWASP ASVS 5.0.0 Level 2](docs/security/asvs-l2.md): of 253 requirements, 183 pass, 9 partial, 2 fail (both accepted risks) and 59 don't apply; the 10 that needed a live site were checked on it in M8. It found 22 issues, none High or Critical; 19 are fixed or documented, 2 are accepted (no two-factor sign-in yet; a cookie-name rule the auth library doesn't support) and 1 was closed once the site was live. It was done by the developer with AI help, not by an independent tester. Full report: [m7-review.md](docs/security/m7-review.md).

## Testing and CI

| Layer         | What runs                                                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit          | 1,444 tests, covering 96% of lines. Coverage thresholds: 80% lines, functions and statements, and 75% branches.                                                                                                                                                             |
| Integration   | 565 tests on real PostgreSQL + pgvector: services, the REST API, tenancy, the job worker, and the prompt-injection set.                                                                                                                                                     |
| End to end    | 20 Playwright suites on desktop and mobile Chromium against the production build: 130 pass, and 10 are skipped by design (desktop-only or mobile-only checks). They include axe scans in both themes, visual comparisons and a keyboard-only walkthrough.                   |
| AI evaluation | The full evaluation with the mock AI on every push, with floors. The Gemini run is manual only, behind a protected environment.                                                                                                                                             |
| Pipeline      | Lint with zero warnings, strict typecheck, formatting, production build and smoke tests, a fail-fast config check, a Docker build with container smoke tests (non-root, HEALTHCHECK), Terraform tests, and the security scans above. On `main`, an approved deploy follows. |

AI coding assistants were used to build this project, under a written policy: AI output is a draft, every change must pass typecheck, lint and tests, and framework APIs are checked against official docs ([CONTRIBUTING.md](CONTRIBUTING.md#ai-assisted-development-policy)).

## Limitations

- **Demo hosting:** the live demo runs on a Lambda Function URL until the custom domain is set up (plan M8 step 6). The first request after a quiet spell takes a few seconds, and the AI stops for the day at the demo's daily limits.
- **The evaluation is small and synthetic:**
  - 35 invented help articles and 420 test items from one free-tier run.
  - Groundedness is graded by an AI model, not checked against a human.
  - Most drafts in the run came from the fallback model, because the main one often timed out on the free tier.
- **Triage:**
  - The 0.95 threshold was chosen on the same 150 tickets it was measured on, so it needs confirming on new data.
  - Existing workspaces keep the threshold they had saved.
  - Prompt v2 was measured on the same 150 tickets whose labelling rubric it was written from, with one run on one model.
- **The Gemini free tier may use inputs to improve Google's products,** so use demo data only.
- **Email is built but not switched on:** password reset and email verification are tested against an in-memory outbox and turn on with the custom domain, once it can be verified for sending. Until then they're hidden, and invite and tracking links are copied and shared by hand.
- **English-only interface**; the AI detects the customer's language.
- **Scale:** one region and a single database. Per-IP limits need a trusted proxy ([AR-004](docs/security/accepted-risks.md)).

## What I'd do next

1. **Custom domain behind CloudFront:** a stricter TLS policy (no CBC ciphers), a redirect from HTTP to HTTPS, and the real visitor IP for per-IP rate limits ([AR-004](docs/security/accepted-risks.md)).
2. **Switch on email** (Resend) for password resets, verification and reply notifications. The code and its tests already exist.
3. **Two-factor sign-in** for owners and admins (accepted risk AR-007).
4. **Check the AI grader against people:** have humans rate a sample of drafts, so groundedness is no longer graded by AI alone.
5. **Measure triage again on new tickets** to confirm the 0.95 threshold, and add error tracking and alarms to the live site beyond the weekly uptime check.

## Roadmap

| Milestone                                    | Status                       |
| -------------------------------------------- | ---------------------------- |
| M0–M2 · Foundation, accounts, workspaces     | Done                         |
| M3 · Ticketing and customer portal           | Done                         |
| M4 · Knowledge base and search               | Done                         |
| M5 · AI triage and cited drafts              | Done                         |
| M6 · Evaluation and observability            | Done                         |
| Design system                                | Done                         |
| Accounts: reset, verification, Google/GitHub | Done (email with the domain) |
| M7 · Security review                         | Done                         |
| M8 · Deployment and live demo                | Live; custom domain later    |
| M9 · Portfolio presentation                  | Done                         |

What was built and verified in each milestone: [milestone log](docs/milestones.md).

## Quick start (local)

Prerequisites: Node.js 24 (`.nvmrc`), pnpm via Corepack (`corepack enable`), Docker.

```bash
cp .env.example .env.local          # dev-only defaults
docker compose up -d db             # PostgreSQL 17 + pgvector (creates the test DB too)
pnpm install --frozen-lockfile
pnpm db:migrate                     # apply SQL migrations + install job queues
pnpm dev                            # http://localhost:3000
pnpm worker                         # background jobs (document ingestion, triage), in a second terminal
DEMO_PASSWORD='choose a long passphrase' pnpm db:seed-demo   # optional demo workspace
```

The demo seed creates "Nimbus Cloud Storage" with `owner@`, `admin@` and `agent@demo.supportpilot.dev`, all using your `DEMO_PASSWORD`, plus **25 synthetic tickets** and a **35-article help centre** as its knowledge base (queued for the worker, ready within a minute or so). Every person and company in them is invented, and addresses use reserved `.test`/`.example` domains. The tickets carry correct category and priority labels and double as the evaluation set for AI triage (M5/M6). Running the seed again is safe: it only adds tickets and articles to an empty workspace.

Switched `AI_PROVIDER` after seeding (e.g. from `mock` to `gemini`)? Search then refuses to compare vectors from two models; run `pnpm kb:reembed --workspace nimbus-demo` with the new settings.

Run the production image locally instead (web, worker and the migration step from one image):

```bash
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
docker compose --profile full up --build
```

## Scripts

| Command                           | What it does                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                      | lint + typecheck + format check + unit tests                                                                     |
| `pnpm test:coverage`              | unit tests with coverage thresholds (80% lines/functions)                                                        |
| `pnpm test:integration`           | tests against real PostgreSQL (`TEST_DATABASE_URL`)                                                              |
| `pnpm test:smoke`                 | checks against a running server (`SMOKE_BASE_URL`) and worker (`SMOKE_DATABASE_URL`)                             |
| `pnpm test:e2e`                   | Playwright + axe against the production build (run `pnpm build` and `pnpm db:migrate` first)                     |
| `pnpm test:e2e:accounts`          | Browser tests for sign-up codes, password reset and the Google/GitHub buttons, on a server with email on         |
| `pnpm build`                      | production build (needs **no** runtime secrets)                                                                  |
| `pnpm worker`                     | background worker from source (needs only `DATABASE_URL` and `AI_PROVIDER`)                                      |
| `pnpm build:scripts`              | bundle the worker, its PDF thread and the migration script into `.build/`                                        |
| `pnpm db:generate` / `db:migrate` | create / apply migrations                                                                                        |
| `pnpm db:seed-demo`               | demo workspace, users, tickets and knowledge base (needs `DEMO_PASSWORD`)                                        |
| `pnpm eval`                       | the full evaluation with 95% intervals (`--check-floors`, `--provider gemini`, `--resume`, `--triage-prompt v1`) |
| `pnpm eval:retrieval`             | retrieval eval: recall@5, MRR@5, latency, cost (`--grid`, `--provider gemini`)                                   |
| `pnpm eval:threshold`             | refusal threshold analysis from cached Gemini embeddings (no API calls)                                          |
| `pnpm kb:reembed`                 | re-embed a workspace's knowledge base after changing the embedding model                                         |
| `pnpm eval:ai`                    | AI smoke run: triage, drafts and the injection set (`--provider gemini`, budgeted and paced)                     |
| `pnpm eval:review`                | `load` the human spot-check items into the database, `status`, or `export` the verdicts to `eval/review/*.json`  |
| `pnpm otel:capture`               | a local trace receiver that prints each span (`--out spans.jsonl`); see [observability](docs/observability.md)   |
| `pnpm sentry:check`               | send one test error to Sentry through the app's reporting path (needs `SENTRY_DSN`)                              |

## Configuration

All settings are environment variables. Most are validated at startup (`src/server/platform/env.ts`), and the server exits if one is invalid. `.env.example` has local defaults.

<details>
<summary>All environment variables</summary>

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
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                       | none                               | Optional Google sign-in (callback: `<BETTER_AUTH_URL>/api/auth/callback/google`)                                                                                                                                                                               |
| `EMAIL_PROVIDER`                                                  | none                               | `resend` (needs a verified domain) or `outbox` (in memory, development and tests). Unset = no password reset or email verification                                                                                                                             |
| `EMAIL_FROM` / `RESEND_API_KEY` / `EMAIL_OUTBOX_TOKEN`            | none                               | Sender address; Resend key; secret for reading the outbox (32+ characters). Required as the provider needs                                                                                                                                                     |
| `AI_PROVIDER`                                                     | `mock` (must be set in production) | `gemini` for real embeddings, triage and drafts; `mock` for deterministic offline AI (tests, local work). Production must choose explicitly, so a deployment never silently runs on fake AI                                                                    |
| `GEMINI_API_KEY`                                                  | none                               | Google AI Studio key, required when `AI_PROVIDER=gemini`. Free-tier inputs may be used by Google to improve its products: demo data only                                                                                                                       |
| `AI_DAILY_CALL_LIMIT`                                             | `200`                              | Triage + draft calls per day for the whole deployment, counted per Pacific-time day (when Google resets free quotas). `0` turns AI generation off                                                                                                              |
| `EVAL_REVIEWER_EMAILS`                                            | none                               | Sign-in emails (comma-separated) allowed to open the evaluation Review page, `/app/review`. Unset: off (no link; the page and its API answer 404)                                                                                                              |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                     | none                               | OpenTelemetry traces over OTLP/HTTP (e.g. `http://localhost:4318`). Unset: no tracing code runs. Only allowlisted metadata is exported, never customer text ([observability](docs/observability.md))                                                           |
| `OTEL_EXPORTER_OTLP_HEADERS`                                      | none                               | Headers for a hosted tracing backend that needs a key (`name=value`)                                                                                                                                                                                           |
| `SENTRY_DSN`                                                      | none                               | Report server errors to Sentry, with personal data collection switched off. Check it with `pnpm sentry:check`                                                                                                                                                  |
| `SENTRY_ENVIRONMENT`                                              | `NODE_ENV`                         | Environment name shown in Sentry (letters, digits, `.` `_` `-`)                                                                                                                                                                                                |
| `LOG_LEVEL`, `DATABASE_POOL_MAX`, `DATABASE_STATEMENT_TIMEOUT_MS` | `info`, `10`, `10000`              | Logging and database tuning                                                                                                                                                                                                                                    |

</details>

## Operational endpoints

<details>
<summary>All REST endpoints and who may call them</summary>

| Endpoint                                       | Who                         |
| ---------------------------------------------- | --------------------------- |
| `POST /api/v1/portal/{slug}/tickets`           | public (rate limited)       |
| `GET /api/v1/portal/t/{token}`                 | customer with tracking link |
| `POST /api/v1/portal/t/{token}/messages`       | customer with tracking link |
| `GET /api/v1/tickets`                          | workspace member            |
| `GET` / `PATCH /api/v1/tickets/{id}`           | workspace member            |
| `POST /api/v1/tickets/{id}/messages`           | workspace member            |
| `GET /api/v1/kb/documents`                     | workspace member            |
| `GET /api/v1/kb/documents/{id}`                | workspace member            |
| `POST /api/v1/kb/documents` (multipart upload) | admin or owner              |
| `DELETE /api/v1/kb/documents/{id}`             | admin or owner              |
| `POST /api/v1/kb/documents/{id}/retry`         | admin or owner              |
| `POST /api/v1/kb/search` (test search)         | admin or owner              |
| `POST /api/v1/tickets/{id}/drafts` (streamed)  | workspace member            |
| `POST /api/v1/drafts/{id}/send`                | workspace member            |
| `POST /api/v1/drafts/{id}/discard`             | workspace member            |
| `POST /api/v1/drafts/{id}/feedback`            | workspace member            |
| `POST /api/v1/tickets/{id}/triage/accept`      | workspace member            |
| `GET /api/v1/settings/ai`                      | workspace member            |
| `PATCH /api/v1/settings/ai`                    | admin or owner              |

</details>

Agent endpoints use the browser session and accept writes only from the app's own origin.

## Documentation

| Doc                                                       | Contents                                                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Case study](docs/case-study.md)                          | The problem, key decisions, results, what went wrong and what changed                                                                                                                     |
| [00 · Research & plan](docs/00-research-and-plan.md)      | Market research with sources, stack choice, roadmap                                                                                                                                       |
| [01 · Requirements](docs/01-requirements.md)              | Roles, functional & non-functional requirements, acceptance criteria                                                                                                                      |
| [02 · Architecture](docs/02-architecture.md)              | System design, data model, API contract, key flows                                                                                                                                        |
| [03 · Threat model](docs/03-threat-model.md)              | STRIDE, OWASP Top 10:2025 and OWASP LLM Top 10 2026 mapping                                                                                                                               |
| [04 · AI evaluation plan](docs/04-ai-evaluation-plan.md)  | Golden dataset, metrics, targets                                                                                                                                                          |
| [ADRs](docs/adr/)                                         | 21 architecture decision records                                                                                                                                                          |
| [Accepted risks](docs/security/accepted-risks.md)         | Known limitations with mitigations and a revisit date                                                                                                                                     |
| [M6 Gemini baseline](docs/eval/m6-baseline.md)            | The full evaluation: results, latency, cost, findings, limits                                                                                                                             |
| [Evaluation folder](docs/eval/README.md)                  | Method, rubric, label checks, retrieval and refusal-threshold analyses                                                                                                                    |
| [Runbook](docs/runbook.md)                                | Running the live demo: releases, rollback, outages, database restore, secret rotation, costs                                                                                              |
| [Infrastructure](infra/README.md)                         | AWS and Terraform setup, deploys, rollback, costs                                                                                                                                         |
| [Observability](docs/observability.md)                    | Logs, traces and Sentry: what is collected, what never is, how to check                                                                                                                   |
| [Design system](docs/design/tokens.md)                    | Tokens, app shell, pages and the quality checks (axe, Lighthouse, visual)                                                                                                                 |
| Milestone plans                                           | [M3](docs/plans/m3-ticketing.md) · [M4](docs/plans/m4-knowledge-base.md) · [M5](docs/plans/m5-ai-features.md) · [M6](docs/plans/m6-evaluation.md) · [Design](docs/plans/design-system.md) |
| [Milestone log](docs/milestones.md)                       | What was built and verified in each milestone                                                                                                                                             |
| [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) | Workflow, AI-assisted development policy, vulnerability reporting                                                                                                                         |

## License

[MIT](LICENSE)
