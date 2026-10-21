# ADR-0011 · Strict nonce CSP instead of Partial Prerendering

Status: Accepted · Date: 2026-10-21

## Context

Threat T11 (docs/03) is cross-site scripting. Its strongest browser-side defence is a Content Security Policy that allows only scripts carrying a per-request nonce (`'strict-dynamic'`), with no `'unsafe-inline'`.

The Next.js 16 CSP guide states that nonces **require dynamic rendering**. A nonce must be unique per response, so statically prerendered HTML cannot carry one. The guide also states that **Partial Prerendering (Cache Components) is incompatible with nonce-based CSP**.

## Decision

- Keep Cache Components/PPR **off** in `next.config.ts`.
- `src/proxy.ts` generates a 16-byte nonce per request and sets the CSP:
  - `script-src 'self' 'nonce-…' 'strict-dynamic'`
  - `style-src 'self' 'nonce-…'`
  - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`
  - `frame-ancestors` from `CSP_FRAME_ANCESTORS`
  - `upgrade-insecure-requests` in production
  - `'unsafe-eval'` only in development, which React needs there
- The root layout calls `await connection()`, so every page renders dynamically and receives the nonce.
- The Playwright suite fails any test that logs a CSP violation. It runs against the production build.

## Consequences

- \+ Injected `<script>` and inline event handlers are blocked even if an XSS bug slips through output encoding.
- \+ E2E enforcement found three real issues, all fixed:
  - Next.js's built-in error page uses inline styles; we now use our own error and not-found pages.
  - Inline `style=""` attributes from UI components.
  - A layout/page race that triggered that error page.
- − No static or partially static pages. Every request renders on the server, which costs CPU and some first-byte latency. For an authenticated, per-tenant app this matters little; the public landing page is the main loss.
- − Components must not use inline styles. Dark mode, which needs an inline pre-paint script, is deferred.
- Revisit if Next.js adds nonce support for prerendered content, or if we move to hash-based CSP for static pages.
