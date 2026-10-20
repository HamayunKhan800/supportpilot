# Security Policy

SupportPilot is a portfolio project, but security issues are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting ("Security" tab → "Report a vulnerability"). You can expect an acknowledgement within 7 days.

## Scope & design

- Threat model: [`docs/03-threat-model.md`](docs/03-threat-model.md) (OWASP Top 10:2025 and OWASP LLM Top 10 2025 mappings)
- Accepted risks: [`docs/security/accepted-risks.md`](docs/security/accepted-risks.md)
- Automated checks: CodeQL, gitleaks, dependency review, `pnpm audit`, and Dependabot (see `.github/`)

The public demo uses synthetic data only. Please do not submit personal data to it.
