# ADR-0016 · A fallback model for drafts when the first is overloaded

Status: Accepted · Date: 2026-10-23 · Extends: [ADR-0015](0015-text-generation-gateway.md) · Code: `src/server/modules/ai/gateway.ts`, `ai/config.ts`

## Context

In the step-6 smoke run on 2026-10-23 (09:05–09:20 PKT), every draft request to `gemini-3.8-flash` failed. Google answered **503 "This model is currently experiencing high demand"** or sent no first chunk within 15 seconds: 10 of 10 requests across two attempts about ten minutes apart (finding #95). In the same session, triage on `gemini-3.5-flash-lite` answered all 20 requests in about one second each. The gateway behaved as designed: each failure showed a clear, retryable message, and the circuit breaker stopped calls after five failures. But with no second option, drafting was simply unavailable while the model was overloaded, and capacity problems like this are outside our control.

## Decision

Streamed text (drafts) has an optional **fallback model**, configured per feature (`fallbackModelId`). Drafts use `gemini-3.5-flash-lite`: it is stable, already used and priced for triage, and was answering during the overload.

The gateway tries the fallback **once**, and only when all of these hold:

- the first model failed on the **provider's side**: a 5xx answer, a network error, no answer in time, or its circuit is open;
- **no text has reached the agent yet**, so two answers are never mixed;
- the failure was **not a 429**. A rate limit applies to the whole Google project, and switching models to get round it would circumvent the provider's limits, which Google's API Terms forbid. A 429 is shown to the agent as before.

It never falls back for the workspace's own limits (AI off, budget, daily cap), for a rejected request (the same request would be rejected again), for invalid output or for a cancelled call.

Each attempt goes through every gateway step on its own: it is checked against the budget, reserves a slot in the daily cap, has its own circuit breaker (one per model, so an overloaded first model does not hold back the fallback), and gets its own `ai_usage` row with its model and price. The fallback uses the same output cap, thinking level and timeouts. The draft records the model that actually wrote it, so evaluation can separate the two. A warning is logged with both model ids.

Triage has no fallback: it runs in a background job that already retries temporary failures with back-off.

## Consequences

- Drafts keep working during an overload of the first model, at lower cost (Flash-Lite is about 2.5 times cheaper for input) and with possibly lower writing quality. The draft's `model` field and the usage table show how often that happens.
- The worst-case wait before an answer grows: up to 15 s for the first model's first chunk, then the fallback's own limits. The 60-second total per attempt is unchanged.
- A fallback call is a second provider request, counted by the daily cap like any other.
- Tested with fault injection: 8 unit tests (503, first-chunk timeout, 429 not rerouted, no fallback after text was delivered or for rejected or cancelled requests, the workspace's limits, an open circuit, both models failing), and 4 deliberately broken rules, each caught.
