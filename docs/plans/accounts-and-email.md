# Accounts: password reset, email verification, Google and GitHub sign-in (2026-10-25)

Status: **approved 2026-10-25** ("Yes, before M7"; "Build now, domain later"; verification by 6-digit code).

## Sources

| Topic                       | Source                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reset and verification APIs | Better Auth, [Email & Password](https://www.better-auth.com/docs/authentication/email-password)                                                                                                                                                                                                                     |
| Verification codes          | Better Auth, [Email OTP plugin](https://www.better-auth.com/docs/plugins/email-otp)                                                                                                                                                                                                                                 |
| Account linking             | Better Auth, [User & Accounts](https://www.better-auth.com/docs/concepts/users-accounts)                                                                                                                                                                                                                            |
| Google provider             | Better Auth, [Google](https://www.better-auth.com/docs/authentication/google)                                                                                                                                                                                                                                       |
| Reset flow rules            | OWASP, [Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)                                                                                                                                                                                               |
| Google review               | Google Cloud, [Manage app audience](https://support.google.com/cloud/answer/15549945?hl=en) and [OAuth app verification](https://support.google.com/cloud/answer/13463073?hl=en): `openid`, `email` and `profile` need no scope review and have no user cap; showing the app name and logo needs brand verification |
| Email delivery              | Resend, [account quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits): free plan 100 emails a day, 3,000 a month. Sending to other people needs a verified domain                                                                                                                              |

Checked in the installed library (better-auth 1.7.12), not only the docs:

- `account.accountLinking.requireLocalEmailVerified` defaults to `true` (`oauth2/link-account.mjs`): a Google or GitHub sign-in joins an existing account only if that account's email is already verified. This blocks pre-account takeover (someone registers your email with their password before you sign in with Google). Set explicitly anyway.
- Reset tokens are stored as `reset-password:<token>` in plain text unless `verification.storeIdentifier` is `"hashed"`. OWASP asks for tokens "stored securely": hashed.
- The Email OTP plugin adds 9 endpoints. Only `send-verification-otp` and `verify-email` are needed; the others (OTP sign-in, OTP password reset, email change) are turned off with `disabledPaths`, and codes are only sent for `email-verification`.

## Decisions

1. **Email behind one small interface** (`src/server/platform/email`) with two implementations: Resend (plain `fetch`, no new package, timeout) and a test outbox (in memory, read through a route that needs a secret token). This is a genuine ports-and-adapters case: two real implementations and tests that must not send mail. `EMAIL_PROVIDER` unset = email features off and today's behaviour unchanged (no reset link, no verification step).
2. **Plain-text emails only.** No HTML, so no markup injection through names.
3. **Not awaited** when sending reset and verification emails (Better Auth's advice against timing attacks). Failures are logged without the address.
4. **Password reset by link** (OWASP: URL tokens are the simplest), valid 30 minutes, single use, hashed at rest. The new password is typed twice and follows the sign-up rules (15–128 characters, breach check). Every session is signed out (already on). A "your password was changed" email follows. No automatic sign-in.
5. **Email verification by 6-digit code**, valid 10 minutes, 3 attempts, stored hashed. Required to sign in when email is on. Signing up with an existing email still looks identical (enumeration protection); the owner of that email gets a short notice instead of a code.
6. **Google and GitHub buttons** appear only when their keys are set. Only `openid email profile` (Google) and the default GitHub scopes. No `trustedProviders`.
7. **Demo accounts** are seeded as verified, so the public demo keeps working without email.
8. **Rate limits** for the new endpoints, stored in the database like the others.

## Steps (one local commit each)

1. Email interface, Resend and outbox implementations, settings validation, unit tests.
2. Forgot and reset password: pages, auth settings, change notice, integration tests.
3. Email verification by code: sign-up and sign-in flow, resend with cooldown, seed, integration tests.
4. Google and GitHub buttons, linking rules, error messages.
5. ADR-0020, threat model, README and `.env.example`; one production build; targeted browser tests (a separate Playwright config with email on).

## Not in this round

Email change, passwordless sign-in, two-factor authentication, account deletion, and a "connected accounts" page.
