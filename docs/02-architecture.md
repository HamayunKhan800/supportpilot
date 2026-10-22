# 02 · Architecture

> Milestone M0 · Status: **Draft for review**. Decisions are explained in `docs/adr/`.

## 1. System context

```mermaid
flowchart LR
  C[Customer browser] -->|HTTPS| APP
  AG[Agent/Admin browser] -->|HTTPS| APP
  subgraph Host["Container platform (same Docker image)"]
    APP["web: Next.js 16 app<br/>UI + REST API + auth"]
    WK["worker: pg-boss consumer<br/>ingestion · triage"]
  end
  APP --> DB[(PostgreSQL 17 + pgvector<br/>managed, e.g. Neon)]
  WK --> DB
  APP --> AI[[Gemini API<br/>LLM + embeddings]]
  WK --> AI
  APP --> OBS[[Sentry + OTel collector]]
  WK --> OBS
  GH[GitHub Actions] -->|build · test · scan · deploy| Host
```

**Style:** a modular monolith. One codebase and one image with two process types (`web`, `worker`). Module boundaries are enforced by folder structure and lint rules, not network calls.

## 2. Code structure (planned)

```
src/
  app/                    # Next.js routes (UI pages + /api route handlers), thin
  server/
    modules/
      tickets/            # service · repository · schemas · policies
      kb/                 # ingestion, chunking, retrieval
      ai/                 # gateway, prompts (versioned), triage, drafting, evals helpers
      workspaces/         # settings, membership, audit
      analytics/
    platform/             # db, auth, logger, errors, rate-limit, env, telemetry, jobs
  components/             # UI (shadcn/ui based)
  worker/                 # job handlers entrypoint
drizzle/                  # SQL migrations (committed)
tests/ {unit,integration,e2e,evals}
```

Rule: route handlers → **service** (business logic + policy check) → **repository** (every query takes `workspaceId`). Lint rules forbid route handlers from importing repositories directly.

## 3. Data model

```mermaid
erDiagram
  USER ||--o{ MEMBER : has
  ORGANIZATION ||--o{ MEMBER : has
  ORGANIZATION ||--o{ INVITATION : has
  ORGANIZATION ||--|| WORKSPACE_SETTINGS : has
  ORGANIZATION ||--o{ TICKET : owns
  TICKET ||--o{ TICKET_MESSAGE : contains
  TICKET ||--o{ TICKET_TRIAGE : "triaged by"
  TICKET ||--o{ AI_DRAFT : "drafted for"
  ORGANIZATION ||--o{ KB_DOCUMENT : owns
  KB_DOCUMENT ||--o{ KB_CHUNK : "split into"
  ORGANIZATION ||--o{ AI_USAGE : meters
  ORGANIZATION ||--o{ AUDIT_LOG : records
```

`USER, SESSION, ACCOUNT, VERIFICATION, ORGANIZATION, MEMBER, INVITATION` are managed by Better Auth (organization plugin). "Workspace" = Better Auth organization. App tables (all have `workspace_id` + indexes leading with it):

| Table                | Key columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_settings` | `workspace_id PK`, `categories text[]`, `ai_enabled`, `monthly_token_budget`, `triage_confidence_threshold`, `retrieval_min_score`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ticket`             | `id uuid`, `workspace_id`, `number` (per-workspace seq), `subject`, `status` enum, `priority` enum, `category`, `customer_name`, `customer_email`, `assignee_id?`, `access_token_hash` (SHA-256 of tracking token), `needs_review bool`, timestamps                                                                                                                                                                                                                                                                                                                                                                                 |
| `ticket_message`     | `id`, `workspace_id`, `ticket_id`, `seq`, `author_type` enum(customer, agent, system), `author_user_id?`, `body`, `is_internal`, `created_at`. An approved AI draft is posted as the agent's own message; `ai_draft.sent_message_id` points back to it.                                                                                                                                                                                                                                                                                                                                                                             |
| `ticket_triage`      | One row per triage run (M5): `status` enum(succeeded, failed, skipped), `error_code?`, `category`, `priority`, `sentiment`, `language` (ISO 639-1), `confidence` 0–1, `reason` ≤200 chars, `model`, `prompt_version`, `applied_category/priority`, `needs_review`, `reviewed_by/at`, `category/priority_override` (what the agent chose instead), `latency_ms`. Tokens and cost are in `ai_usage`.                                                                                                                                                                                                                                  |
| `ai_draft`           | `id`, `workspace_id`, `ticket_id`, `requested_by`, `status` enum(generating, ready, refused, blocked, failed, aborted, sent, discarded), `error_code?`, `body` (with `[n]` markers), `language`, `model?` (null when refused before any call), `prompt_version`, `retrieval_top_score`, `invalid_citation_count`, `warnings[]`, tokens, cost, `ttft_ms`, `latency_ms`, `sent_message_id?`, `edit_ratio?`, `feedback?` (up/down + note). **`ai_draft_citation`**: one row per `[n]` with a snapshot of the passage (title, heading, text) and `chunk_id?`/`document_id?`, set to null when the source is deleted ("source removed"). |
| `kb_document`        | `id`, `workspace_id`, `title`, `filename` (display only), `mime_type` (detected from content), `size_bytes`, `sha256` (unique per workspace), `status` enum, `error_code?`, `page_count?`, `chunk_count`, `token_estimate`, `embedding_model?` (e.g. `gemini-embedding-2@768`), `uploaded_by`, `ingested_at?`, timestamps                                                                                                                                                                                                                                                                                                           |
| `kb_document_blob`   | `document_id PK`, `bytes bytea`. Deleted after successful ingestion (see ADR-0002)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `kb_chunk`           | `id`, `workspace_id`, `document_id` (composite FK with `workspace_id`), `ordinal`, `heading_path`, `content`, `token_estimate` (characters ÷ 4), `embedding vector(768)`, `tsv tsvector` (generated, `english` config, headings weighted A)                                                                                                                                                                                                                                                                                                                                                                                         |
| `ai_usage`           | `id`, `workspace_id`, `feature` enum(triage, draft, embed), `model`, `input_tokens`, `output_tokens`, `est_cost_micros`, `outcome` enum(ok, refused, blocked, invalid, timeout, error, aborted), `latency_ms?`, `ttft_ms?`, `ticket_id?`, `created_at`. Created at M4; M5 added outcome and timing and uses it for the monthly budget. **`ai_daily_calls`** (`day`, `scope`, `calls`): the deployment-wide daily call cap, one atomic upsert per call (ADR-0015).                                                                                                                                                                   |
| `audit_log`          | `id`, `workspace_id`, `actor_user_id?`, `actor_type`, `action`, `target_type`, `target_id`, `metadata jsonb`, `created_at` (append-only; no UPDATE/DELETE in app code)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `rate_limit`         | `key`, `window_start`, `count` (Postgres fixed-window limiter, works across instances)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Indexes: `kb_chunk` HNSW on `embedding` (cosine) and GIN on `tsv`; `ticket (workspace_id, status, created_at desc)`; `ticket (access_token_hash)` unique. Embedding dimension is **768** (`gemini-embedding-2` with `output_dimensionality`, one of Google's recommended sizes; pgvector's HNSW index caps `vector` at 2,000 dimensions). It is fixed per deployment; changing it needs a migration and a re-embed. Vector queries use pgvector ≥ 0.8 iterative index scans so the per-workspace filter can't starve results.

## 4. API contract (v1)

- REST via Next.js Route Handlers under `/api/v1`. JSON only. Request bodies, params and queries are validated with Zod. The OpenAPI 3.1 document is **generated from the Zod schemas** and served at `/api/v1/openapi.json`.
- Errors use **RFC 9457** `application/problem+json`: `{ type, title, status, detail, instance, requestId, errors? }`.
- The authenticated workspace context comes from the session's _active organization_. Membership and role are re-checked on every request.
- Pagination is cursor-based: `?cursor=&limit=` (max 50).

| Method & path                            | Auth                         | Purpose                                              |
| ---------------------------------------- | ---------------------------- | ---------------------------------------------------- |
| `GET /api/health` · `GET /api/ready`     | public                       | liveness / DB readiness                              |
| `/api/auth/*`                            | Better Auth                  | sign-up, sign-in, OAuth, sessions, orgs, invitations |
| `POST /api/v1/portal/{slug}/tickets`     | public + rate limit          | create ticket → `{ trackingUrl }`                    |
| `GET /api/v1/portal/t/{token}`           | tracking token               | ticket + public messages                             |
| `POST /api/v1/portal/t/{token}/messages` | tracking token               | customer reply                                       |
| `GET /api/v1/tickets`                    | agent+                       | queue (filters, search, cursor)                      |
| `GET /api/v1/tickets/{id}`               | agent+                       | ticket, messages, latest triage, drafts              |
| `PATCH /api/v1/tickets/{id}`             | agent+                       | status / priority / category / assignee              |
| `POST /api/v1/tickets/{id}/messages`     | agent+                       | reply or internal note                               |
| `POST /api/v1/tickets/{id}/triage`       | agent+                       | re-run AI triage                                     |
| `PUT /api/v1/tickets/{id}/triage`        | agent+                       | human override                                       |
| `POST /api/v1/tickets/{id}/drafts`       | agent+                       | generate draft (**streaming** response)              |
| `POST /api/v1/drafts/{id}/approve`       | agent+                       | body: final text → posts reply                       |
| `POST /api/v1/drafts/{id}/feedback`      | agent+                       | 👍/👎 + reason                                       |
| `GET/POST /api/v1/kb/documents`          | read: agent+ · write: admin+ | list / upload (multipart)                            |
| `GET/DELETE /api/v1/kb/documents/{id}`   | read: agent+ · write: admin+ | status + passages / delete doc + chunks              |
| `POST /api/v1/kb/documents/{id}/retry`   | admin+                       | re-queue a failed document                           |
| `POST /api/v1/kb/search`                 | admin+                       | test search (ranked by meaning, ADR-0014)            |
| `GET/PATCH /api/v1/workspace/settings`   | read: agent+ · write: admin+ | settings                                             |
| `GET /api/v1/analytics/summary`          | agent+                       | dashboard metrics                                    |
| `GET /api/v1/audit`                      | admin+                       | audit log                                            |

Tracking tokens: 32 random bytes (base64url), with only the SHA-256 stored. Tracking pages send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

## 5. Key flows

### 5.1 Ticket creation + triage

```mermaid
sequenceDiagram
  participant C as Customer
  participant W as web
  participant DB as Postgres
  participant K as worker
  participant L as Gemini
  C->>W: POST /portal/{slug}/tickets
  W->>W: rate-limit (IP) · Zod validate · honeypot
  W->>DB: tx: insert ticket + message + audit + enqueue job "ticket.triage"
  W-->>C: 201 { trackingUrl }
  K->>DB: fetch job
  K->>L: structured output (Zod schema: category ∈ workspace enum …)
  K->>DB: insert ticket_triage, update ticket, ai_usage
  Note over K: retry w/ backoff on 429/5xx, after max attempts set needs_review = true
```

The job is enqueued **inside the same transaction** as the ticket insert (pg-boss supports this because it lives in Postgres), so no ticket is ever left untriaged because of a crash in between.

### 5.2 Knowledge ingestion

Upload → validate size + **magic bytes** (not just extension) → store blob + `kb_document(pending)` → job `kb.ingest`:
extract text (PDF page cap checked before extraction; PDFs parsed in a `worker_threads` thread with a memory cap and a 30 s hard kill, so a hostile file can't block the event loop) → normalize → **heading-aware chunking** (~500 tokens, ~15% overlap; exact values tuned at M4 using recall@5) → embed in batches → insert chunks → `ready` → delete blob. The job is idempotent: re-running it replaces that document's chunks inside a transaction.

### 5.3 Grounded draft generation

1. Policy check (agent+), AI enabled, **budget check**, per-user rate limit.
2. Build the query from the subject and recent customer messages, then embed it.
3. **Retrieval:** pgvector top 8 + Postgres full-text top 8 → top 5, ranked by vector similarity. Full-text matches are labelled but don't change the order: equal-weight Reciprocal Rank Fusion ranked worse on the Gemini eval ([ADR-0014](adr/0014-retrieval-ranking.md)).
4. If the best vector score < `retrieval_min_score` (calibrated at M6), store a `refused` draft and **skip the LLM**.
5. Prompt (versioned file, e.g. `draft.v1`): rules, then sources wrapped in `<source id="1">…</source>` and labelled _untrusted data_, then the customer message wrapped and labelled the same way.
6. `streamText` to the client (TTFT and total time measured). Timeout 30 s.
7. On finish: parse `[n]` markers, **drop and flag any citation not in the retrieved set**, persist the draft, usage and latency.
8. The agent edits and approves. A message is created, and `edit_ratio` is stored (normalized Levenshtein).

### 5.4 AI gateway (single choke point for all model calls)

- Provider from env: `AI_PROVIDER=gemini|mock` (`mock` is deterministic and used in CI/tests and when no key is set).
- Timeouts, retries (non-streaming only, 429/5xx, exponential backoff + jitter), a **circuit breaker** (opens after repeated failures, then shows an "AI temporarily unavailable" banner).
- Usage accounting: tokens → `ai_usage`, estimated cost from a **dated price table in config** (source URL recorded).
- Logs model, prompt version, latency and tokens, but **never prompt or customer content** at info level.

## 6. Cross-cutting

- **Config:** env vars parsed with Zod at boot; the process fails fast if invalid. `.env.example` is committed, secrets never are.
- **Errors:** typed domain errors → mapped to Problem Details in one place. Unknown errors → 500 with requestId only, full detail goes to Sentry.
- **Logging:** pino JSON, request ID from proxy, redaction paths (`authorization`, `cookie`, `password`, `email`, `token`, message bodies).
- **Security headers:** nonce-based CSP, HSTS, `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- **Markdown rendering of AI output:** sanitized. Raw HTML disabled, **remote images disabled** (blocks exfiltration via image URLs), links shown with their full domain and `rel="noopener noreferrer nofollow"`.

## 7. Deployment topology (decided in detail at M8)

One Docker image (multi-stage, non-root, minimal base) runs as two services: `web` (`node server.js`, Next.js standalone output) and `worker`. Managed Postgres with pgvector. Migrations run as a release step before the new version receives traffic. Environments: `local` (Docker Compose on a laptop / local Postgres in sandbox), `ci` (service container), `staging`, and `production`. Exact platform choice and current free-tier limits will be checked against official pricing pages at M8.
