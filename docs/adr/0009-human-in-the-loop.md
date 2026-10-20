# ADR-0009 · Human-in-the-loop: AI never sends to customers

Status: Accepted · Date: 2026-10-19

## Decision

AI produces suggestions only (triage labels, drafts). A human must approve before any text reaches a customer. The model has no tools and no write access.

## Why

Stack Overflow 2026: 48% of developers trust AI output when they can easily verify it, and only 6.6% trust it for important decisions. OWASP LLM06 (Excessive Agency) and LLM01 (Prompt Injection) say to limit impact rather than rely on prevention.

## Consequences

- Prompt injection cannot directly harm customers. − No fully automated deflection in v1 (self-service answers are a stretch goal with a separate risk review).
