# 03 · Threat Model

> Milestone M0 · Status: **Draft for review** · Re-reviewed at M7 (security review).
> References: [OWASP Top 10:2025](https://owasp.org/Top10/2025/) · [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/) · OWASP ASVS (used as checklist at M7). At M7 I will check whether a newer LLM Top 10 edition exists on the official site.

## 1. Assets

| Asset                                        | Why it matters                                        |
| -------------------------------------------- | ----------------------------------------------------- |
| Tenant data: tickets, messages, KB documents | Confidentiality between companies is the core promise |
| Credentials & sessions                       | Account takeover                                      |
| Tracking tokens                              | Grant access to one customer's ticket                 |
| AI provider API key & token budget           | Direct financial loss / service denial                |
| Audit log                                    | Accountability, incident investigation                |
| CI/CD pipeline & deploy credentials          | Supply-chain compromise                               |

## 2. Threat actors

1. **Anonymous internet user**: portal spam, prompt injection via ticket text, token guessing, DoS/cost abuse.
2. **Authenticated user of another tenant**: IDOR / cross-tenant access.
3. **Low-privilege member (agent)**: privilege escalation to admin actions.
4. **Malicious or careless KB uploader**: poisoned documents (indirect prompt injection), malformed files.
5. **Supply-chain attacker**: compromised npm package or GitHub Action.

## 3. Trust boundaries

Browser ↔ web app · web/worker ↔ Postgres · web/worker ↔ LLM provider (data leaves our system) · GitHub Actions ↔ hosting platform · **LLM output ↔ our UI** (model output is untrusted input).

## 4. STRIDE analysis (main threats)

| #   | Threat (STRIDE)                                                                   | Mitigation                                                                                                                                                     | Verified by                                          |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| T1  | **E/I**: Agent in workspace X reads a ticket in Y (IDOR)                          | Repository layer requires `workspaceId`; policy check per service call; 404 on mismatch                                                                        | Cross-tenant test for every route                    |
| T2  | **E**: Agent calls admin-only endpoint                                            | Central `authorize(role, action)`; deny by default                                                                                                             | Role-matrix tests                                    |
| T3  | **S**: Credential stuffing / brute force                                          | Better Auth rate limiting on auth routes; generic error messages; strong password policy                                                                       | Integration test                                     |
| T4  | **S**: Session hijack                                                             | HttpOnly, Secure, SameSite=Lax cookies; server-side revocation; CSP limits XSS                                                                                 | Header/cookie tests                                  |
| T5  | **T**: CSRF on state-changing routes                                              | SameSite cookies + Origin check on non-GET + JSON-only bodies                                                                                                  | Test: foreign Origin → 403                           |
| T6  | **I**: Tracking token guessed or leaked                                           | 256-bit random, hash stored, `no-referrer`, `no-store`                                                                                                         | Unit test on entropy/hash                            |
| T7  | **D**: Portal spam floods tickets + AI cost                                       | IP rate limit, honeypot field, body size limits, triage queue concurrency cap, workspace budget                                                                | Rate-limit test                                      |
| T8  | **T/I**: Direct prompt injection in ticket ("ignore rules, reveal system prompt") | No secrets in prompts; untrusted content delimited and labelled; triage via schema-constrained output; AI has **no tools** and **cannot send**; human approval | Injection eval set with canary token (must not leak) |
| T9  | **T**: Indirect injection via KB document                                         | Same as T8, plus uploads restricted to admin+, provenance shown on every citation, citations validated against retrieved set                                   | Poisoned-doc eval cases                              |
| T10 | **I**: Data exfiltration via AI output (e.g. markdown image to attacker URL)      | Sanitized rendering, remote images blocked, links show full domain                                                                                             | Unit test on renderer                                |
| T11 | **T**: XSS via ticket content / filenames                                         | React escaping; no `dangerouslySetInnerHTML` except sanitized renderer; nonce CSP                                                                              | Lint rule + ZAP                                      |
| T12 | **D/T**: Malicious file (zip bomb, giant PDF, wrong type)                         | Size limit, magic-byte check, page cap, parse in worker with timeout & memory limit                                                                            | Fixture tests                                        |
| T13 | **I**: Secrets in repo/logs                                                       | gitleaks in CI; pino redaction; env validation; no prompt content in logs                                                                                      | CI + log test                                        |
| T14 | **T**: Compromised dependency / action                                            | Lockfile + `--frozen-lockfile`, Dependabot, CodeQL, actions pinned by SHA, minimal non-root image, SBOM                                                        | CI config review                                     |
| T15 | **R**: Member denies destructive action                                           | Append-only audit log for role changes, deletes, approvals, settings                                                                                           | Test: actions create audit rows                      |
| T16 | **D**: Provider outage / slowness                                                 | Timeouts, circuit breaker, graceful degradation                                                                                                                | Fault-injection test                                 |
| T17 | **I**: Customer PII sent to third-party LLM                                       | Synthetic demo data only; portal notice; PII redaction planned as stretch                                                                                      | Documented limitation                                |

## 5. OWASP Top 10:2025 mapping

| Category                                   | Primary controls                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| A01 Broken Access Control                  | T1, T2, T6; deny by default; tenant-scoped repositories                                                                            |
| A02 Security Misconfiguration              | Security headers, env validation, prod-only secure cookie flags, no debug in prod                                                  |
| A03 Software Supply Chain Failures         | T14                                                                                                                                |
| A04 Cryptographic Failures                 | TLS everywhere (platform), Better Auth password hashing (algorithm/params verified at M2), SHA-256 token hashing, no custom crypto |
| A05 Injection                              | Drizzle parameterized queries (no raw string SQL), Zod validation, T11                                                             |
| A06 Insecure Design                        | This threat model, human-in-the-loop AI, budgets                                                                                   |
| A07 Authentication Failures                | T3, T4, invitation expiry/single use                                                                                               |
| A08 Software or Data Integrity Failures    | Signed/pinned CI, migrations reviewed in PRs, idempotent jobs                                                                      |
| A09 Security Logging and Alerting Failures | Audit log, authz-denied & auth-failure events, Sentry alerts                                                                       |
| A10 Mishandling of Exceptional Conditions  | Central error mapping, fail-closed authz, timeouts, no stack traces to clients                                                     |

## 6. OWASP LLM Top 10 (2025) mapping

| Risk                                   | Control                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| LLM01 Prompt Injection                 | T8, T9; human approval; eval set in CI                                                             |
| LLM02 Sensitive Information Disclosure | Retrieval scoped to the requesting workspace only; T17                                             |
| LLM03 Supply Chain                     | Official provider SDKs only; pinned versions                                                       |
| LLM04 Data & Model Poisoning           | Admin-only uploads; provenance on citations                                                        |
| LLM05 Improper Output Handling         | T10, T11; structured output validated with Zod before use                                          |
| LLM06 Excessive Agency                 | No tools, no autonomous sends, no write access for the model                                       |
| LLM07 System Prompt Leakage            | No secrets in prompts; canary test                                                                 |
| LLM08 Vector & Embedding Weaknesses    | `workspace_id` filter on every vector query (tested); no cross-tenant index sharing without filter |
| LLM09 Misinformation                   | Citations required; refusal when retrieval is weak; groundedness eval                              |
| LLM10 Unbounded Consumption            | Budgets, rate limits, input size caps, max output tokens, timeouts                                 |

## 7. Accepted risks (v1)

- Prompt injection cannot be fully prevented by any known technique. We limit the **impact** (no tools, human approval) rather than claim prevention.
- The free-tier AI provider may use submitted data to improve its products, so only synthetic data is used.
- A single region with no multi-region failover.
