# 01 · Requirements Specification

> Milestone M0 · Status: **Draft for review** · Owner: project author
> Decisions locked: SupportPilot · low-cost container hosting · TypeScript only · Gemini API (free tier) + mock provider · 5–10 h/week review time.

## 1. Product summary

SupportPilot is a multi-tenant customer-support platform. Customers submit tickets through a public portal. Support agents work a shared queue. AI **triages** each ticket and **drafts replies grounded in the workspace's own knowledge base, with citations**. A human must approve every AI draft before it reaches a customer.

Demo tenant: **"Nimbus Cloud Storage"**, a fictional SaaS company. All demo data is synthetic.

## 2. Personas & roles

| Role       | Who                              | Authenticated?                          |
| ---------- | -------------------------------- | --------------------------------------- |
| `owner`    | Created the workspace            | Yes                                     |
| `admin`    | Team lead                        | Yes                                     |
| `agent`    | Support staff                    | Yes                                     |
| `customer` | End user of the tenant's product | No. Holds a secret ticket-tracking link |

### 2.1 Permission matrix (enforced server-side; the UI only hides controls)

| Capability                                                | owner | admin |   agent   | customer (own ticket) |
| --------------------------------------------------------- | :---: | :---: | :-------: | :-------------------: |
| Submit ticket via portal                                  |   –   |   –   |     –     |          ✅           |
| View / reply on own ticket thread                         |   –   |   –   |     –     |          ✅           |
| View ticket queue & tickets                               |  ✅   |  ✅   |    ✅     |           –           |
| Reply / internal note / change status, priority, assignee |  ✅   |  ✅   |    ✅     |           –           |
| Generate / edit / approve AI drafts                       |  ✅   |  ✅   |    ✅     |           –           |
| Override AI triage                                        |  ✅   |  ✅   |    ✅     |           –           |
| View knowledge base documents                             |  ✅   |  ✅   |    ✅     |           –           |
| Upload / delete knowledge base documents                  |  ✅   |  ✅   |     –     |           –           |
| Edit workspace settings (categories, AI on/off, budget)   |  ✅   |  ✅   |     –     |           –           |
| Invite members / change roles (not owner)                 |  ✅   |  ✅   |     –     |           –           |
| View analytics                                            |  ✅   |  ✅   | ✅ (read) |           –           |
| View audit log                                            |  ✅   |  ✅   |     –     |           –           |
| Delete workspace / transfer ownership                     |  ✅   |   –   |     –     |           –           |

## 3. Functional requirements

IDs are referenced by tests (`describe("FR-T3 …")`).

### Auth & workspaces (A)

- **FR-A1** Sign up / sign in with email+password; optional GitHub OAuth.
- **FR-A2** Create a workspace (name, unique slug); the creator becomes `owner`.
- **FR-A3** Invite by email with a role; invitation expires after 7 days; single use.
- **FR-A4** Users may belong to several workspaces and switch the active one.
- **FR-A5** Sign out revokes the session server-side; a password change revokes all other sessions.

### Tickets (T)

- **FR-T1** Public portal at `/p/{slug}`: name, email, subject, message. Returns a **secret tracking link**.
- **FR-T2** Customer can view the thread and reply via the tracking link (internal notes are never shown).
- **FR-T3** Agent queue: filter by status/priority/category/assignee; text search; cursor pagination.
- **FR-T4** Ticket lifecycle: `open → pending → resolved → closed` (reopen allowed from `resolved`).
- **FR-T5** Agents post public replies or internal notes; assign tickets to members.
- **FR-T6** Every state change is written to the audit log.

### Knowledge base (K)

- **FR-K1** Admins upload `.md`, `.txt`, `.pdf` (≤ 5 MB, PDF ≤ 50 pages).
- **FR-K2** Ingestion runs asynchronously (extract → chunk → embed). Status is visible: `pending / processing / ready / failed (reason)`.
- **FR-K3** Deleting a document removes its chunks immediately; drafts keep a record of citations to deleted sources (shown as "source removed").
- **FR-K4** Admin "test search" box shows which chunks retrieval returns for a query (debug aid).

### AI (AI)

- **FR-AI1** On ticket creation, triage runs automatically: category (from workspace list), priority, sentiment, language, confidence.
- **FR-AI2** Triage with confidence < threshold is flagged "needs review". Agent overrides are stored for evaluation.
- **FR-AI3** Agent clicks **Generate draft** to get a streamed reply with inline citations `[1] [2]` linking to source chunks.
- **FR-AI4** If retrieval finds nothing relevant, the system returns an explicit "insufficient knowledge" result **without calling the LLM**.
- **FR-AI5** Drafts are editable; **Approve & send** posts them as the agent's reply. No AI output reaches a customer without approval.
- **FR-AI6** Agent feedback (👍/👎 + reason) on drafts.
- **FR-AI7** Per-workspace monthly token budget; drafting is blocked with a clear message when it is exhausted.
- **FR-AI8** If the AI provider fails, all non-AI features keep working, and the UI shows a retryable error.

### Analytics (AN)

- **FR-AN1** Dashboard: ticket volume by status/category, AI draft acceptance rate, average edit ratio, triage override rate, AI latency p50/p95, tokens and estimated cost per period.

## 4. Non-functional requirements

| ID        | Requirement                                                                                                                    | Measure / verification                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| NFR-SEC1  | Tenant isolation: cross-workspace access returns 404                                                                           | Automated test for **every** tenant-scoped route |
| NFR-SEC2  | Role matrix (§2.1) enforced server-side                                                                                        | Table-driven authorization tests                 |
| NFR-SEC3  | All input validated (Zod); errors use RFC 9457 Problem Details; no stack traces leak                                           | Contract tests                                   |
| NFR-SEC4  | 0 high/critical open findings at release (CodeQL, dependency audit, gitleaks, ZAP baseline)                                    | CI artifacts                                     |
| NFR-SEC5  | Security headers (CSP with nonces, HSTS, frame-ancestors none, Referrer-Policy)                                                | Header test + ZAP                                |
| NFR-A11Y1 | WCAG 2.2 AA target; 0 serious/critical axe violations on key pages; full keyboard operation                                    | Playwright + axe; manual keyboard pass           |
| NFR-RESP1 | Usable from 360 px width up                                                                                                    | Playwright mobile + desktop viewports            |
| NFR-PERF1 | Non-AI API p95 < 300 ms at demo load (k6, 20 virtual users)                                                                    | k6 report                                        |
| NFR-PERF2 | Lighthouse performance ≥ 90 on portal page                                                                                     | Lighthouse CI                                    |
| NFR-AI1   | AI quality targets (see `04-ai-evaluation-plan.md`)                                                                            | Eval report                                      |
| NFR-AI2   | Draft TTFT and total latency recorded per request; p50/p95 reported                                                            | Telemetry                                        |
| NFR-REL1  | `/api/health` (liveness) and `/api/ready` (DB) endpoints                                                                       | Smoke test                                       |
| NFR-REL2  | Background jobs retry with backoff and are idempotent                                                                          | Integration tests                                |
| NFR-OBS1  | Structured JSON logs with request ID; PII and secrets redacted                                                                 | Log-redaction unit test                          |
| NFR-OBS2  | Errors reported to Sentry; traces via OpenTelemetry                                                                            | Manual verification at M6                        |
| NFR-QA1   | Every PR runs lint, typecheck, unit, integration, E2E, build                                                                   | Branch protection                                |
| NFR-PRIV1 | Only synthetic data in demo; portal shows "do not submit personal data" notice (free-tier AI data may be used by the provider) | Visual check                                     |

## 5. Key user stories (Given/When/Then)

**US-1 Customer gets help**
Given the Nimbus portal, when a customer submits a valid ticket, then they see a tracking link within 1 s, the ticket appears in the agent queue, and triage completes asynchronously.

**US-2 Agent uses a grounded draft**
Given a ticket whose answer exists in the KB, when the agent clicks _Generate draft_, then text begins streaming, each citation opens the exact source passage, and _Approve & send_ posts the (edited) reply to the customer thread.

**US-3 Unanswerable question**
Given a ticket about a topic absent from the KB, when the agent generates a draft, then the system shows "Insufficient knowledge, no reliable sources found" and makes no LLM call.

**US-4 Tenant isolation**
Given agent A in workspace X, when A requests a ticket ID belonging to workspace Y, then the response is 404 and an authorization-denied event is logged.

**US-5 Provider outage**
Given the AI provider returns errors, when an agent generates a draft, then a clear retryable error appears, and ticket viewing/replying still works.

## 6. Out of scope (v1)

Billing, email ingestion, mobile apps, autonomous AI replies, URL/web crawling import, SSO/SAML, multi-language UI (customer messages in any language are supported).
