# Security Policy

SupportPilot is a portfolio project, but security issues are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting ("Security" tab → "Report a vulnerability"). You can expect an acknowledgement within 7 days.

## Scope & design

- Threat model: [`docs/03-threat-model.md`](docs/03-threat-model.md) (OWASP Top 10:2025 and OWASP LLM Top 10 2026 mappings)
- Accepted risks: [`docs/security/accepted-risks.md`](docs/security/accepted-risks.md)
- Security review (M7): [`docs/security/m7-review.md`](docs/security/m7-review.md) and the [ASVS 5.0 Level 2 checklist](docs/security/asvs-l2.md)
- Automated checks: CodeQL, gitleaks, dependency review, `pnpm audit`, OWASP ZAP scans, Dependabot, and a CycloneDX SBOM on every CI run (see `.github/`)

## Fixing vulnerable dependencies

Time frames start when an advisory affects code that ships (production dependencies). They are our own, set by risk in the way CISA's [BOD 26-04](https://www.cisa.gov/news-events/directives/bod-26-04-prioritizing-security-updates-based-risk) (June 2026) recommends: a vulnerability that is known to be exploited, in a public-facing system, comes first.

| Situation                                                                                                                                                  | Fix or mitigate within  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| On CISA's [Known Exploited Vulnerabilities](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) list (the shortest BOD 26-04 timeline is 3 days) | 3 days                  |
| Critical                                                                                                                                                   | 15 days                 |
| High                                                                                                                                                       | 30 days                 |
| Medium                                                                                                                                                     | 90 days                 |
| Low                                                                                                                                                        | the next planned update |

CI blocks a merge while a high or critical advisory is open in production dependencies (`pnpm audit --prod --audit-level=high`). If no fix exists, the risk is written down with its mitigation in [`docs/security/accepted-risks.md`](docs/security/accepted-risks.md). Development-only advisories are reviewed the same way but don't block.

The public demo uses synthetic data only. Please do not submit personal data to it.
