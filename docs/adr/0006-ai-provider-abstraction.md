# ADR-0006 · AI via Vercel AI SDK; Gemini (free tier) default; deterministic mock for tests

Status: Accepted · Date: 2026-10-19

## Decision

All model calls go through one internal **AI gateway** built on the Vercel AI SDK (provider-agnostic; streaming; Zod structured outputs). Default provider is the **Google Gemini API**, using a Flash-Lite-class model for triage, a Flash-class model for drafts and Gemini Embedding for vectors. Exact model IDs are confirmed against official docs at M5. `AI_PROVIDER=mock` gives deterministic responses for CI, tests and keyless local dev.

## Why

- The Gemini API has a free tier for current Flash/Flash-Lite and embedding models (official pricing page, checked 2026-10-19), so there is zero cost to build and demo, with no card required.
- OpenAI and Anthropic APIs are prepaid/paid. The code stays provider-agnostic, so switching to them later is a config change plus re-embedding.

## Consequences

- Free-tier quotas are low and are shown per project in Google AI Studio rather than published. Mitigation: rate limits, refusal-before-LLM, and a mock for CI.
- On the free tier, Google may use submitted content to improve its products, so **only synthetic data** goes in, and the portal displays a notice.
- Prices change (Google lists increases for some models in Dec 2026/Jan 2027). Cost estimates use a dated price table in config.
