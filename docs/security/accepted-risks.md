# Accepted Security Risks

Reviewed at every milestone and at M7 (security review). Each entry has an owner decision and a review date.

| ID     | Finding                                                                                                                    | Scope                                                                                       | Why accepted                                                                                                                                         | Mitigation                                                                                                 | Review by |
| ------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------- |
| AR-001 | `braces <=3.0.3` stack-exhaustion DoS ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)), **high** | Dev only: `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces` | No patched version published (checked 2026-10-20). Only parses glob patterns from our own lint config, never user input. Not in the production image | CI blocks on any high advisory in **production** deps (`pnpm audit --prod`). Dependabot will surface a fix | M7        |

## Resolved

| ID    | Finding                                                                                                                                                       | Resolution                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| R-001 | `esbuild <=0.24.2` ([GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)), moderate, dev-only via `drizzle-kit → @esbuild-kit/core-utils` | pnpm override to `esbuild ^0.25.0` (pnpm-workspace.yaml). Verified `drizzle-kit generate/check` still work |

## Notes for later milestones

- **M8:** Next.js generates per-build keys (preview mode, server actions) inside `.next/`. Gitleaks flags them in a local directory scan. They are gitignored, and the git-history scan in CI is clean. If multiple instances are deployed, set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` consistently (check current Next.js docs at M8).
