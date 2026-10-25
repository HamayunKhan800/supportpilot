# M7 security review

> Done 2026-10-25. Plan: [`docs/plans/m7-security-review.md`](../plans/m7-security-review.md). Every finding, its ASVS link and its status: [`asvs-l2.md`](asvs-l2.md#findings).

## Summary

- **Standard:** OWASP ASVS 5.0.0 Level 2, plus OWASP Top 10:2025, the OWASP Top 10 for LLM Applications 2026 and the OWASP Web Security Testing Guide. Severity follows the OWASP Risk Rating idea (likelihood × impact).
- **Result:** 22 findings: 4 Medium, 15 Low, 3 Info, and no High or Critical. 19 were fixed or documented in step 5, 2 are accepted risks ([AR-007](accepted-risks.md) no multi-factor sign-in, [AR-008](accepted-risks.md) cookie prefix), and 1 waits for the hosting platform (M7-11, `TRACE`, M8).
- **ASVS Level 2 (253 requirements):** 174 pass, 8 partial, 2 fail (both accepted risks), 10 depend on the hosting platform (M8), 59 don't apply. Before the fixes: 149 pass, 18 partial, 17 fail.
- **Exit gate met:** no High or Critical finding is open, and every open item is in [`accepted-risks.md`](accepted-risks.md).
- **Limits of this review:** it was done by the developer with AI help, not by an independent tester, and not against a live deployment (that is M8). Anything not tested is listed below.

## How it was done

| Step | What                                                                                                                                                                                         | Output                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1    | Scope and threat model refreshed (T1–T27)                                                                                                                                                    | [`03-threat-model.md`](../03-threat-model.md)                              |
| 2    | Every ASVS Level 1 and 2 requirement checked against code, tests, library source and the production build                                                                                    | [`asvs-l2.md`](asvs-l2.md)                                                 |
| 3    | OWASP ZAP 2.17.0 passive scan (64 public and 299 signed-in URLs) and active API scan (about 7,660 requests), against a throwaway copy                                                        | [`.zap/README.md`](../../.zap/README.md); M7-17 to M7-20; a CI job (`zap`) |
| 4    | Hands-on attacks (WSTG) on a production build                                                                                                                                                | Below; M7-21, M7-22; M7-01 and M7-14 confirmed                             |
| 5    | Fixes, each with a test, and documents ([crypto inventory](crypto-inventory.md), [data classification](data-classification.md), SBOM, fix time frames in [`SECURITY.md`](../../SECURITY.md)) | 4 local commits                                                            |
| 6    | Full test suites, ZAP baseline re-run, this report                                                                                                                                           | Below                                                                      |

## Main fixes (step 5)

- **Sign-in limits can't be dodged (M7-01).** The auth library used to take the client IP from `X-Forwarded-For`, so a fake value gave a fresh limit on every try. It now reads only an IP the app sets, using the same rule as the rest of the app.
- **Stronger password hashing (M7-02).** scrypt with an OWASP setting (N=2^14, r=8, p=5) and a versioned format; old hashes are upgraded at the next sign-in.
- **Sessions end 7 days after sign-in (M7-03)**, however active they are, and users can see and sign out their other devices on the Account page (M7-05).
- **Smaller fixes:** cache cleared on sign-out (M7-06), provider tokens encrypted (M7-07), passwords containing the product or email name refused (M7-08), refused permissions logged with who and what (M7-09), at most 5 workspaces per person (M7-14), no redirects on the email call (M7-16), `nosniff` on static files (M7-17), forms always post (M7-18), NUL characters can't cause a 500 (M7-19), two unused library endpoints closed (M7-21, M7-22), at most 5 account emails per address per hour (T18).
- **One bug found along the way:** the M7-01 fix worked in tests but broke sign-up in the production build. The browser tests caught it before commit.

## Step 4: hands-on tests (OWASP WSTG)

**Setup.** A production build on `127.0.0.1` with its own throwaway database (seeded demo data, mock AI). Settings match the production defaults: auth rate limits on, `TRUST_PROXY_HEADERS=false`, email off. A probe script sent each attack and compared the answer with the expected one. Most of the checks were already automated tests, as listed below. New tests are in `tests/integration/auth-endpoints.test.ts`; tests for the failures are added with their fixes in step 5.

### Failed (findings)

| Threat | Test                                                                                                | Result                                                                                           | Finding |
| ------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------- |
| T27    | 12 wrong passwords for one account, with a new fake `X-Forwarded-For` each time                     | Never limited (12 × 401). The same IP is limited after 5, as configured.                         | M7-01   |
| T27    | 7 wrong passwords with no IP header, then a correct sign-in by someone else, also with no IP header | The bystander got 429: one shared bucket, so one attacker can block everyone                     | M7-01   |
| T20    | One user creates 7 workspaces in a row                                                              | All accepted                                                                                     | M7-14   |
| T21    | Owner or admin calls `/organization/update` directly                                                | Accepted: slug `Bad Slug/../x`, a 5,000-character name, a `javascript:` logo                     | M7-21   |
| T21    | Any user calls `/update-user` directly                                                              | Accepted: a 5,000-character name and a `javascript:` image; a NUL character in the name gave 500 | M7-22   |

### Passed

| Threat  | What was tried                                                                                                                                                                                                                                                                                                                            | Automated test                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| T1      | `/api/v1`: every id route with another workspace's IDs → 404, and nothing changed                                                                                                                                                                                                                                                         | `api-v1.test.ts` (generated from the route list)         |
| T1      | Library: outsider can't switch into, read (by id or slug), list members or invitations of, invite into, or rename another workspace, or accept an invitation sent to another email                                                                                                                                                        | `workspaces.test.ts`, `auth-endpoints.test.ts` (by slug) |
| T2      | `/api/v1`: every route as owner, admin and agent gets exactly what the permission matrix allows                                                                                                                                                                                                                                           | `api-v1.test.ts`                                         |
| T2      | Library: agent can't invite, promote themselves or remove members; admin can't invite an owner, make themselves owner or remove the owner; `add-member` isn't reachable over HTTP                                                                                                                                                         | `workspaces.test.ts`, `auth-endpoints.test.ts`           |
| T21     | Closed or protected: account deletion, email change, workspace deletion, the only owner leaving, unlinking the only sign-in method, changing the email through `/update-user`                                                                                                                                                             | `auth-endpoints.test.ts`, `workspaces.test.ts`           |
| T5      | Library write with a foreign `Origin`, `Origin: null` or none → 403                                                                                                                                                                                                                                                                       | `auth.test.ts`, `api-v1.test.ts`                         |
| T26     | Foreign `callbackURL` on sign-in, sign-up and social sign-in, and a `//` `errorCallbackURL`, → 403. `/sign-in?next=` with `//evil`, `https://evil`, `/\evil`, `javascript:` and an encoded `//` never redirects off-site. The auth error page doesn't reflect a script. A failed OAuth callback (bad `state`) redirects only on this site | `safe-redirect` unit tests; library checks               |
| T6      | Tracking token is 43 random URL-safe characters; one changed character → 404; page sends `no-referrer`, `no-store` and noindex; the API answer has no internal fields                                                                                                                                                                     | `api-v1.test.ts`, `portal.spec.ts`                       |
| T7      | Portal limit holds with a new fake IP per request (`201 ×4`, then 429). The honeypot field gets a normal-looking 201 but no ticket is stored                                                                                                                                                                                              | `tickets-service.test.ts`, `portal.spec.ts`              |
| T12     | A program renamed `.pdf` → 400 (content check). Corrupt and garbage PDFs → failed, `pdf_invalid`. A 1.4 MB PDF that inflates to about 400 MB → the parser thread hit its memory cap → failed, `pdf_too_complex`; the worker kept running. A `../../etc/…` name with a right-to-left override character is stored as a plain name          | `kb-api.test.ts`, `kb-ingest-job.test.ts`, unit tests    |
| T11     | A Markdown file with `<script>` and `<img onerror>` displays as text on the document page (escaped in HTML and in the page data)                                                                                                                                                                                                          | React escaping                                           |
| T23     | `/api/dev/email-outbox` → 404 with email off; `/app/review` → 404 for a non-reviewer                                                                                                                                                                                                                                                      | `accounts.spec.ts`, `review.spec.ts`                     |
| T4      | A signed-out cookie stops working; a forged cookie → 401                                                                                                                                                                                                                                                                                  | `auth.test.ts`                                           |
| T8–T10  | Prompt-injection suites re-run: 20 integration and 8 unit tests pass                                                                                                                                                                                                                                                                      | `injection.test.ts`, `injection-cases.test.ts`           |
| T3, T18 | Already covered and passing: same answer for a wrong password and an unknown email; reset links single-use, hashed and expiring; every session ends after a reset                                                                                                                                                                         | `auth.test.ts`, `auth-email.test.ts`                     |

### Notes

- **Info:** when the library refuses a switch into someone else's workspace (403), it also clears the caller's own active workspace. Only the caller is affected; they pick their workspace again. No change.
- **Info:** the library answers 401 (not 403) when an agent tries to remove a member. The request is still refused and nothing changes.
- A proxy-style two-value `X-Forwarded-For` (`client, proxy`) makes the library see no IP at all, so behind a real proxy every visitor would share one sign-in bucket. The M7-01 fix covers this, and M8 checks it on the real host.

### Not tested in step 4

- Password-reset and code-sending floods per account. Email was off on the test server. These endpoints use the same IP-keyed limiter as sign-in, so M7-01 applies to them too; per-address email limits were added in step 5 (5 an hour, `auth-email.test.ts`).
- Real Google and GitHub sign-in (needs the live callback URLs, M8). Only the redirect and `state` checks above were run.
- Timing differences between a wrong password and an unknown email (needs many samples on stable hardware).

## Step 6: final checks (2026-10-25)

All on one production build with mock AI. The ZAP scan used a throwaway database.

| Check                                        | Result                                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests                                   | 1381 passed                                                                                                                       |
| Integration tests (real Postgres)            | 543 passed                                                                                                                        |
| Browser tests (desktop and phone)            | 118 passed, 10 skipped on purpose (tests meant only for the other screen size or a fresh review database)                         |
| ZAP baseline (63 public, 300 signed-in URLs) | Exit code 0; only "Modern Web Application" (information) left. Rule 10024 (M7-18) and rule 10021 on static files (M7-17) are gone |

The first ZAP re-run found two more things, both handled before the commit:

- `nosniff` was still missing on `/favicon.ico`, which the request filter skips. Added in `next.config.ts`, checked with curl, the scan re-run, and the security, landing and session browser tests re-run (39 passed).
- Rule 10202 (no anti-CSRF token) flagged the landing page's demo form once it used `method="post"`. That form runs in the browser only and sends no request, so the alert is filtered as a false positive with that reason in `.zap/baseline.yaml`.

## Not tested in M7

- Anything on a live deployment: HTTPS, HSTS, the host's proxy and `TRUST_PROXY_HEADERS`, real email sending, real Google and GitHub sign-in, database TLS (all M8).
- The ZAP API scan after the fixes (the NUL fix is covered by integration tests), and the CI `zap` job before its first run on this push.
- Timing differences between a wrong password and an unknown email.
- A review by an independent security tester.
