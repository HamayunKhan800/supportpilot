# ADR-0015 · Text generation: models, thinking, limits, prompt versions and streaming

Status: Accepted · Date: 2026-10-22 · Details: [M5 plan](../plans/m5-ai-features.md) D1–D3, D6, D12–D14 · Code: `src/server/modules/ai/`

## Context

M5 adds the first features where a language model writes something: ticket triage (structured labels) and reply drafts (streamed prose with citations). Some decisions are expensive to get wrong:

1. **Which models, at what thinking level.** Price, latency and shutdown dates differ by model, and thinking tokens are billed as output.
2. **How usage is limited.** Gemini free-tier quotas are per project and per model, shown only in AI Studio, and a 429 can mean the requests-per-minute or the daily limit (M4 finding #70). A public demo must not be able to use them up, and a workspace must not exceed its budget (FR-AI7, OWASP LLM06:2026).
3. **What a failure looks like.** The AI SDK reports some failures by throwing and others as stream parts. I probed `ai` 7.0.142 to check:
   - a timeout throws a `TimeoutError`;
   - a cancellation throws an `AbortError`;
   - a stalled stream ends with an `abort` part and does not throw;
   - a provider error mid-stream arrives as an `error` part, and `result.text` still resolves with the partial text.
4. **How prompts change over time** without losing the ability to compare results.

## Decision

**Models and thinking (one config file, `ai/config.ts`):**

| Feature | Model                   | Thinking  | Output cap | Timeouts                                      |
| ------- | ----------------------- | --------- | ---------- | --------------------------------------------- |
| Triage  | `gemini-3.5-flash-lite` | `minimal` | 200 tokens | 20 s total                                    |
| Drafts  | `gemini-3.8-flash`      | `low`     | 800 tokens | 15 s to first chunk, 10 s between, 60 s total |

- Stable model IDs only, never `-latest` aliases. Neither model has a shutdown date on Google's deprecations page (checked 2026-10-22).
- Thinking uses the SDK's provider-neutral `reasoning` setting. `@ai-sdk/google` 4.0.97 maps it to `thinkingLevel` and raises it to each model's minimum: `minimal` stays `minimal` on Flash-Lite and becomes `low` on 3.8 Flash, which rejects `minimal`. A unit test captures the real Gemini request body with a fake `fetch` and checks the level, the output cap and JSON mode actually sent. A live call confirms Google accepts them in the step-6 smoke run.
- A **dated price table** (USD per million tokens, from Google's pricing page) gives every call an estimated paid-tier cost. 3.8 Flash has an introductory price until 2026-12-31, so the table has an `until` date. A model with no price throws instead of being recorded as free.

**One gateway for every model call (`ai/gateway.ts`).** Each call goes through the same steps, in order:

1. AI enabled for the workspace? (No settings row counts as off: fail closed.)
2. Monthly token budget left? Counts triage and draft tokens this UTC month. Embeddings are excluded: they cost about a hundredth as much per token and are bounded by upload limits; M8 adds their own daily budget.
3. Circuit closed for this model? After 5 consecutive failures, calls fail at once for 60 s. Then one trial call is let through. There is one breaker per model, per process.
4. Reserve one slot in the **deployment-wide daily cap** (`AI_DAILY_CALL_LIMIT`, default 200). This is a single atomic `INSERT … ON CONFLICT DO UPDATE … WHERE calls < limit` on `ai_daily_calls`, so concurrent web and worker processes cannot overshoot it (integration-tested with 20 parallel reservations). The day is the Pacific-time date, because Google resets daily quotas at midnight Pacific.
5. Call the model with **SDK retries off** (`maxRetries: 0`), the timeouts and output cap above, and the caller's abort signal.
6. Record the outcome in `ai_usage`: `ok`, `invalid`, `timeout`, `error` or `aborted` (plus `refused` and `blocked`, written by the draft engine), with tokens, cost, latency, time to first token and ticket id.

Steps 1–4 make no network call, so a refused call costs nothing. Prompts and outputs are never logged (plan D11).

**Why SDK retries are off** (a change to plan D13). Each SDK retry is a separate provider request that the daily cap would not see, and the default back-off of a few seconds rarely outlasts a per-minute limit. Triage is retried by its pg-boss job with longer back-off; each attempt goes through the gateway, so it is counted and seen by the breaker. Drafts make one attempt, and the agent can retry.

**Failures are classified like the embedder's** (`classifyEmbeddingError`):

| Cause                                | Error                                                                 |
| ------------------------------------ | --------------------------------------------------------------------- |
| 429 / 408 / 5xx / network            | `ai_unavailable` (with Retry-After if sent)                           |
| 400 / 401 / 403 / 404                | `ai_rejected`                                                         |
| Unparseable or schema-invalid output | `ai_invalid_output` (its tokens are still recorded: they were billed) |
| SDK timeout                          | `ai_timeout`                                                          |

- The caller's own signal is the only way to tell a cancellation (`ai_aborted`) from a timeout.
- **For streams, `error` and `abort` parts count as failures**, so a broken stream never produces a "successful" half answer. If the provider stops mid-stream it reports no token usage; the gateway then estimates tokens as characters ÷ 4, so the cost isn't hidden.
- If writing a chunk to the client fails, the provider call is cancelled.
- Unavailable, timeout and rejected count against the breaker. Invalid output counts as success (the provider answered). An abort counts as neither.

**Mock provider.** The offline provider uses the SDK's own `MockLanguageModelV4` (from `ai/test`, which has no test-runner dependencies). Prompting, JSON mode, streaming and usage recording therefore take exactly the same SDK path as with Gemini. Each feature supplies a deterministic responder with its prompt (triage in step 2, drafts in step 3). Unit tests inject faults with the same class: 429, 500, timeout, stalled first chunk, stalled mid-stream, total timeout, malformed JSON, schema-invalid output, mid-stream error, client abort and client disconnect.

**Prompt versioning.** Prompts live in versioned files (`triage.v1`, `draft.v1`, from steps 2 and 3). Every triage run and draft stores its `prompt_version` and `model`, so results and costs can be compared across versions. A changed prompt gets a new version, never an edit in place.

**Streaming protocol (implemented in step 3).**

- `POST /api/v1/tickets/{number}/drafts` returns newline-delimited JSON: `{"type":"delta","text":…}` lines, then exactly one `{"type":"done",…}` or `{"type":"error","code":…}`.
- Headers: `Content-Type: application/x-ndjson`, `Cache-Control: no-store` and `Content-Encoding: none`. The last one stops proxies from buffering the stream, as the AI SDK docs advise.
- The browser reads it with `fetch` and a stream reader, so the strict CSP's `connect-src 'self'` stays unchanged.
- NDJSON over a plain POST was chosen over Server-Sent Events: the request needs a body and CSRF-checked POST semantics, and the response has a natural end.

## Consequences

- **Benefits:**
  - One place enforces every limit; a new AI feature can't bypass the budget, the cap or the breaker.
  - Costs and failures are measured per call from day one (NFR-AI2), ready for the M6 dashboard.
  - CI needs no key; every failure path has a test, and each test was checked by deliberately breaking the code it guards (7 gateway changes, 6 SQL changes, all caught).
- **Costs:**
  - The budget check and the call are not atomic. Concurrent calls can overshoot a workspace budget by at most their own tokens, each capped by the output limit. The daily cap is exact.
  - Breakers are per process: the web app and the worker each need 5 failures to open their own.
  - Mid-stream token counts are estimates when the provider doesn't report them.
  - Google may use free-tier inputs to improve its products, so the demo uses synthetic data only (M4 plan D14).

## Revisit when

- Google announces a shutdown date or a price change for either model (update `config.ts`);
- the step-6 smoke run shows Flash-Lite rejecting `minimal`, or drafts cut short by the output cap (`finishReason: "length"` is recorded);
- the app runs more than one web instance at real traffic levels (a shared breaker state may then be worth it).
