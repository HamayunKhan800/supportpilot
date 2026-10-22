# M3 · Ticketing: implementation plan

> Status: **Approved 2026-10-22** · Drafted 2026-10-21
> Implements FR-T1–T6 (docs/01 §3), NFR-SEC1/SEC3/A11Y1/RESP1/PRIV1, and threats T1, T5, T6, T7, T11, T15 (docs/03).
> No AI in this milestone. Triage and drafts come in M5. M3 builds the ticket system they will plug into.

## 1. What a user can do when M3 is done

**Customer** (no account):

1. Opens the workspace portal `/p/nimbus-demo` and submits name, email, subject and message.
2. Gets a **private tracking link**, shown once with a Copy button and a "save this link" warning. No email is sent yet (email arrives in M8).
3. Opens the link to read the conversation and reply. Internal notes are never shown.

**Agent / admin / owner** (signed in):

1. **Inbox** `/app/tickets`:
   - filter by status, priority, category and assignee ("me", "unassigned", a person)
   - search the text
   - page through results
2. **Ticket page** `/app/tickets/{number}`:
   - read the thread
   - write a **public reply** or an **internal note** (visually distinct)
   - change status, priority, category and assignee
3. Every change is in the **audit log**.

## 2. Design decisions

| #   | Decision                                                                                                                                                                                                                                                                                             | Why                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Tracking token:** 32 random bytes (256-bit), only the **SHA-256 hash** is stored. Pages served `no-store` + `Referrer-Policy: no-referrer`. Logs record the route pattern, never the token.                                                                                                        | T6. A database leak does not reveal working links. Guessing is infeasible.                                                                  |
| D2  | **Lifecycle as a tested state machine:** `open → pending → resolved → closed`, reopen from `resolved`. A customer reply on `pending`/`resolved` moves the ticket back to `open`. `closed` is final (customer sees "start a new request").                                                            | FR-T4. One table of allowed transitions, unit-tested for every pair. Invalid moves return 409.                                              |
| D3  | **Per-workspace ticket numbers** (#1, #2, …) from a counter row locked inside the insert transaction.                                                                                                                                                                                                | Readable URLs without exposing other tenants' volumes. A concurrency test creates tickets in parallel and checks for no gaps or duplicates. |
| D4  | **Optimistic concurrency:** each ticket has a `version`. An update sent with a stale version gets **409 Conflict** ("this ticket changed since you opened it").                                                                                                                                      | Two agents editing the same ticket must not silently overwrite each other.                                                                  |
| D5  | **One service layer, two entry points:** REST API `/api/v1/...` (documented, OpenAPI 3.1 generated from the Zod schemas) **and** Server Actions for the UI, both calling the same services and the same Zod schemas.                                                                                 | API for integrations/portfolio. Server Actions give forms that work without client-side fetch code. Rules exist in one place.               |
| D6  | **Errors:** RFC 9457 Problem Details everywhere. Cross-tenant ticket IDs return **404** (not 403), so IDs can't be probed.                                                                                                                                                                           | NFR-SEC1, NFR-SEC3, T1.                                                                                                                     |
| D7  | **Portal abuse controls (T7):** Postgres rate limiter per IP and per workspace (own table `app_rate_limit`; Better Auth already uses `rate_limit`), hidden honeypot field, request-size and field-length limits. CAPTCHA deferred (third-party scripts conflict with the strict CSP; revisit at M8). | Cheap, works across instances, no third-party script.                                                                                       |
| D8  | **Message text is plain text only** (React-escaped, line breaks preserved). No HTML or Markdown in M3.                                                                                                                                                                                               | T11. The sanitized renderer arrives with AI drafts in M5 (T10).                                                                             |
| D9  | **Search:** PostgreSQL full-text search (generated `tsvector` + GIN index) over subject and messages, `websearch_to_tsquery` syntax. **Keyset pagination** on `(created_at, id)`.                                                                                                                    | No extra service. Keyset avoids the skipped-row bug found in M2 (finding #21).                                                              |
| D10 | Portal shows a **"do not submit personal data"** notice. The demo uses synthetic tickets only.                                                                                                                                                                                                       | NFR-PRIV1, T17.                                                                                                                             |

## 3. Steps (each one committed with CI green)

1. **Database:** migration `0002` adds `ticket`, `ticket_message`, the ticket counter, `app_rate_limit`, plus indexes. Repository functions that all require `workspaceId`, with integration tests for numbering under concurrency and tenant scoping.
2. **Rules:** Zod schemas, lifecycle state machine, permission checks, tracking-token module, rate limiter, ticket services and audit events. Unit + integration tests.
3. **REST API + OpenAPI:**
   - Route handlers with Problem Details.
   - `/api/v1/openapi.json`.
   - Contract tests.
   - **A cross-tenant test for every route** (NFR-SEC1).
   - A role-matrix test.
4. **Customer portal UI:** submit form, tracking page, reply.
5. **Agent UI:** inbox with filters, search and paging. Ticket page with thread, reply/note composer and side panel. Nav link plus open-ticket count on the overview.
6. **Finish:**
   - E2E journeys: customer submits → agent replies → customer sees the reply but not the note → resolve → customer reply reopens.
   - axe scans on desktop and mobile; a token-leak check.
   - About 25 synthetic Nimbus demo tickets (reused for the M5 AI evaluation).
   - ADR-0012 (tracking-link design), screenshots, docs.

## 4. Done when

- [ ] FR-T1–T6 each covered by named tests (`describe("FR-T3 …")`).
- [ ] Cross-tenant test for **every** ticket route returns 404. Role-matrix tests pass.
- [ ] Lifecycle: every allowed and forbidden transition tested.
- [ ] Customers can never see internal notes (tested at API, service and E2E level).
- [ ] Portal rate limit, honeypot and size limits tested.
- [ ] 0 serious/critical axe violations on portal, tracking, inbox and ticket pages (desktop + mobile).
- [ ] OpenAPI document generated and validated in CI.
- [ ] CI green.

## 5. Out of scope for M3

- Email notifications and "lost my link" recovery (M8, needs an email provider)
- File attachments
- AI triage and drafts (M5)
- CAPTCHA (revisit at M8)
- SLA timers
- Bulk actions
