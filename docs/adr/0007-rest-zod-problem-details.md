# ADR-0007 · REST route handlers + Zod + RFC 9457 Problem Details + generated OpenAPI
Status: Accepted · Date: 2026-10-19

## Decision
All mutations and client data fetches go through versioned REST route handlers (`/api/v1`). Zod schemas validate every input and generate the OpenAPI 3.1 document. Errors use RFC 9457 `application/problem+json`. Server Components read through the same service layer; Server Actions are not used for mutations.

## Why
A single explicit, documented, testable API surface: each route can be contract- and authz-tested, and reviewers can read the OpenAPI spec.

## Consequences
+ Clear security boundary, easy integration tests. − Slightly more code than Server Actions for forms.
