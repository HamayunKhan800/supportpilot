# ADR-0020 · Password reset, email verification by code, and Google/GitHub sign-in

Status: Accepted · Date: 2026-10-25 · Plan: [accounts-and-email](../plans/accounts-and-email.md) · Related: [ADR-0004](0004-better-auth.md) · Code: `src/server/platform/email/`, `src/server/platform/auth/auth.ts`, `src/server/platform/auth/account-emails.ts`, `src/app/(auth)/`

## Context

Until now, sign-in was email and password only, with no way to recover an account, no proof that an email address belongs to the person who typed it, and GitHub sign-in only on the server (no button). Employers expect all three. Two constraints shaped the design:

- **No domain yet.** Resend, like every reputable sender, delivers to other people only from a verified domain. On the free plan it allows 100 emails a day and 3,000 a month ([Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits)). The domain arrives with deployment (M8).
- **Account security rules.** OWASP's [Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) and the existing enumeration protection (threat T3) must hold.

## Decision

- **Email behind one small interface** with two implementations: Resend over `fetch` (no new package, 10 s timeout, status-only errors) and an in-memory outbox for development and tests. The outbox is read through `/api/dev/email-outbox`, which answers 404 unless `EMAIL_PROVIDER=outbox` and the request carries `EMAIL_OUTBOX_TOKEN` (at least 32 characters, compared in constant time). With no email setting, every email feature is off and the app behaves exactly as before. That is the default and the state of the demo until M8.
- **Plain-text emails only, with nothing a user typed in them**, so a message can't carry injected markup or someone else's words.
- **Sending is never awaited** (Better Auth's advice), so an existing account doesn't answer more slowly than an unknown one.
- **Reset by link**, the simplest form OWASP describes. Better Auth's built-in flow, with:
  - 30-minute single-use tokens, stored hashed (`verification.storeIdentifier: "hashed"`; the default is plain text)
  - the same answer for known and unknown emails
  - the new password typed twice, with the sign-up rules (15–128 characters, breach check)
  - every session signed out, no automatic sign-in, and a "password changed" email (also after a normal password change)
  - `Referrer-Policy: no-referrer` on the reset paths
- **Verification by 6-digit code** (the owner's choice), using the Better Auth Email OTP plugin with `overrideDefaultEmailVerification`:
  - codes last 10 minutes, allow 3 tries and are stored hashed
  - a fresh code is sent on sign-up and on each sign-in with the right password
  - `requireEmailVerification` is on whenever email is on
  - signing up with a taken email still gets the same response, and its owner gets a notice instead of a code
  - the plugin's other endpoints (code sign-in, code reset, email change, and link verification) are closed with `disabledPaths`, and only `email-verification` codes can be requested
- **Google and GitHub buttons** appear only when both keys of a provider are set.
  - Google uses its default scopes only (`openid email profile`), which need no Google app review ([Google Cloud help](https://support.google.com/cloud/answer/15549945?hl=en)), plus `prompt=select_account`.
  - Account linking is explicit: `requireLocalEmailVerified: true` (the library default, checked in `oauth2/link-account.mjs`) and no `trustedProviders`. A provider sign-in joins an existing account only if both the provider and this app have verified the email. This blocks pre-account takeover: registering someone's email with your password before they first use Google.
  - Errors come back as `?error=<code>` and are shown as fixed messages, never echoed.
- **Rate limits** on the new endpoints, stored in the database: reset requests 3 a minute, resets 5, code sends 3, code checks 5.
- **Demo accounts are seeded as verified** (their addresses can't receive mail), and the seed runs with email off.

## Consequences

- **Tests:** 16 integration tests run against the real database and outbox. Separate browser tests (`pnpm test:e2e:accounts`, own server with email on) cover desktop and phone.
- **Real users when email is switched on:** an existing account whose email was never verified is asked for a code at its next sign-in. That's one extra step, not a lockout.
- **Not yet:**
  - **Per-account limits:** the limits are per IP. Better Auth has no per-account limit on reset requests, so someone rotating IPs could send several reset emails to one address. Each link still expires, and nothing changes without it. Review at M7.
  - **No retry:** an email that fails to send is logged without the address and not retried. The person can ask again.
  - **No account page for providers:** no "connected accounts" page, no email change, no passwordless sign-in and no two-factor authentication.
- **Before going live (M8):** verify a domain in Resend; register the production callback URLs (`<BETTER_AUTH_URL>/api/auth/callback/google` and `/github`); and, to show the app's name and logo on Google's consent screen, complete Google's brand verification ([Google Cloud help](https://support.google.com/cloud/answer/13463073?hl=en)).
