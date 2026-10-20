# ADR-0004 · Better Auth with organization plugin

Status: Accepted · Date: 2026-10-19

## Decision

Better Auth for email+password, GitHub OAuth, DB-backed sessions, and organizations/members/invitations (organization = workspace). The active workspace comes from the session and is re-verified against membership on each request.

## Why

Auth.js (NextAuth) has been maintained by the Better Auth team since Sept 2025, and its maintainers recommend Better Auth for new projects. Self-hosted means no per-user vendor cost, and user data stays in our database.

## Alternatives

Clerk/Auth0: excellent, but hosted, with costs above free tiers and less to demonstrate. Writing our own auth: rejected (OWASP A07 risk).

## Consequences

- Mature session, rate-limit and org primitives. − Must verify defaults at M2 (hashing algorithm, cookie flags, rate limits, trusted origins) rather than assume them.
