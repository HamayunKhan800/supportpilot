# Plan · M7 Security review

> Status: **approved by the owner** (2026-10-25).
> Roadmap row (docs/00 §5): threat-model review, ZAP baseline, CodeQL, dependency and secret scans,
> ASVS-based checklist. Exit gate: **0 high or critical findings open**, or each one documented
> with a reason in `docs/security/accepted-risks.md`.

## Standards used

| Standard                                             | Why                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OWASP ASVS 5.0.0, Level 2** (released 30 May 2025) | The checklist. 345 requirements in 17 chapters: 70 at L1, 183 at L2, 92 at L3. L2 is the level OWASP recommends for business apps that hold personal data, which a support inbox does. Chapters that don't apply (V17 WebRTC; most of V9 self-contained tokens, since sessions are cookies) are marked N/A with a reason. |
| **OWASP Top 10:2025**                                | Summary view for the README and the report.                                                                                                                                                                                                                                                                               |
| **OWASP Top 10 for LLM Applications 2026**           | The AI parts: prompt injection, output handling, cost abuse, data leaving to the model provider.                                                                                                                                                                                                                          |
| **OWASP WSTG**                                       | How to run each manual test.                                                                                                                                                                                                                                                                                              |
| **OWASP Risk Rating**                                | Severity (likelihood × impact) for each finding.                                                                                                                                                                                                                                                                          |

## Steps (one local commit each, one push at the end)

1. **Threat model re-review.** Update `docs/03-threat-model.md` for what was built after M0: Google and GitHub sign-in, reset links and email codes, the portal and tracking links, file uploads, the AI drafts and the evaluation tools. Output: updated STRIDE table and a list of new threats to test in step 4.
2. **ASVS 5.0 L2 checklist.** New `docs/security/asvs-l2.md`: every L1 and L2 requirement marked pass, fail or N/A, each with evidence (a file, a test or a scan result). Every "fail" goes to the fix list.
3. **Automated scans.**
   - **ZAP baseline** (passive, safe): a new job in `security.yml` that starts the production build in CI with mock AI and a test database, then scans it. Action `zaproxy/action-baseline` v0.15.0, pinned by commit SHA like the other actions. A rules file lists any alert that is reviewed and accepted.
   - **ZAP API scan** (active attacks): manual-only workflow against the same throwaway CI copy, using the app's own OpenAPI file. It never touches a real site.
   - Already in place and re-checked: CodeQL, gitleaks over the whole history, dependency review, `pnpm audit` (AR-001 reviewed again).
4. **Manual and scripted tests** (WSTG), most turned into automated tests:
   - **Tenant isolation matrix:** every `/api/v1` route called with another workspace's IDs must answer 404.
   - **Roles:** an agent calling admin and owner actions must get 403, for every route.
   - Tracking links (guessing, other tickets), sign-in and reset abuse, rate limits, open redirects, OAuth state, session revocation after a password reset.
   - Uploads: oversized and malformed PDFs, wrong file types.
   - AI: prompt injection from tickets and documents (the existing tests are re-run and extended), cost limits.
5. **Fix what is found**, smallest change and a test each. Known items already waiting:
   - Per-account limits on password-reset requests (today per IP only).
   - Each draft request looks up the session twice (seen in M6 tracing).
   - A missing API field gets zod's default technical message (low).
6. **Report.** `docs/security/m7-review.md`: findings table (severity, status, fix commit or accepted-risk entry), scan results, what was not tested. README gets a short security section. Then the full test suite, one push, CI green.

## Rules kept

- No changes to tables without a separate plan and approval.
- No new runtime dependencies. ZAP runs only in CI (Docker), never in the app.
- Active scans only against throwaway local or CI copies, never a third-party site.
- Report only what was verified; anything not tested is listed as not tested.

## Not in M7

- A paid or external penetration test (listed as a limitation).
- Two-factor sign-in, connected-accounts page (product features, later).
- Production checks that need the live site (HTTPS, real email, real OAuth callbacks): M8.
