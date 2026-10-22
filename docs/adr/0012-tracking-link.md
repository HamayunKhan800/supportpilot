# ADR-0012 · Private tracking links for customers without accounts

Status: Accepted · Date: 2026-10-22

## Context

Customers send requests through the public portal `/p/{slug}` without creating an account (FR-T1). They still need a way to read replies and answer (FR-T2). M3 has no email (that arrives in M8), so the link must be shown once on screen.

Whoever holds the link can read the conversation, which may contain personal details. Threat T6 (docs/03) is a tracking link that is guessed or leaked.

Options considered:

| Option                                                       | Why not (for M3)                                                                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer accounts                                            | Friction for a one-off question; another password to protect.                                                                                               |
| Ticket number + email address                                | Both are guessable or easy to find out, so this is weak authentication.                                                                                     |
| Emailed magic link                                           | Needs an email provider (M8). Planned as "lost my link" recovery.                                                                                           |
| Token in the URL fragment (`#…`), read by client-side script | Browsers never send fragments to the server or in `Referer`, but the page could not be rendered on the server, and the API would need a header-based token. |
| **Random token in the URL path, hardened (chosen)**          | Works with server rendering and without JavaScript; the risks below are each mitigated and tested.                                                          |

## Decision

**The token** (`src/server/modules/tickets/tracking-token.ts`):

- 32 bytes from `crypto.randomBytes` (256 bits), encoded as 43 base64url characters.
- Only the **SHA-256 hash** is stored (`ticket.access_token_hash`, unique). A database leak reveals no working links. A fast hash is fine here because the input is random, not a password a person chose.
- Input that doesn't look like a token (`^[A-Za-z0-9_-]{43}$`) is rejected before any database query.
- Unknown tokens get a plain 404 that never echoes the token.

**Keeping the URL from leaking:**

- `Referrer-Policy: no-referrer` on `/t/` and `/api/v1/portal/t/`, set in `src/proxy.ts` (`referrerPolicyFor`), plus a `<meta name="referrer">` tag on the page.
- `Cache-Control: no-store` on the page and the API, so shared or back-button caches don't keep a copy.
- `noindex, nofollow`, so search engines never list a link someone posted publicly.
- The page title is "Your support request", never the subject or the token, because titles end up in history and tab-sync.
- Logs record the route name (`getCustomerTicket`), never the path. Error responses for token routes omit `instance` (finding #30).
- Agents never see the token: only its hash is stored, and the agent API and pages have no field for it.

**Limiting what a link can do:**

- The customer view shows public messages only: no internal notes, no assignee, no internal IDs, and not even the customer's own email address.
- Replies are rate-limited per ticket (10 per 10 minutes), and a closed ticket accepts no replies.

## Verification

- Unit: token length and alphabet, hash round-trip, malformed input rejected (`tests/unit/tracking-token.test.ts`).
- Integration and API: unknown or malformed tokens give 404 without echoing the token; responses carry `no-store`; internal notes are never returned.
- E2E (`tests/e2e/portal.spec.ts`, `agent-inbox.spec.ts`):
  - headers and meta tags on the real page;
  - every request the tracking page makes (scripts, styles, the reply) carries no `Referer` containing the token;
  - the token appears nowhere in the agent inbox, ticket page, audit log or agent API.
- **Mutation check:** with the referrer protection switched back to the site default (`strict-origin-when-cross-origin`), the E2E test failed. The browser attached the full private URL to more than a dozen same-origin requests. So the protection is load-bearing.

## Consequences

- \+ No accounts or email are needed to follow a request, and the design is easy to reason about: the link is the credential.
- \+ A database dump or a log file does not reveal working links.
- − **Anyone who has the link can read the conversation.** That is inherent to bearer links. The portal tells the customer to keep the link private and not to send sensitive data (D10).
- − **A lost link can't be recovered in M3.** The customer has to submit a new request. Email recovery is planned for M8.
- − The link stays valid until the ticket is deleted. There is no expiry or revocation yet. Revisit with M8: rotate the token when a link is re-sent, and consider expiring links some time after closure.
- − The URL lives in the customer's browser history. Platform access logs at the host (M8) will also record full URLs. **M8 must check the hosting provider's request logging** and redact or disable path logging for `/t/` if possible. This is listed in the M8 notes in `docs/security/accepted-risks.md`, with the expiry gap tracked as AR-005.
