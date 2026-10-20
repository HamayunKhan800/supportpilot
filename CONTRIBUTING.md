# Contributing

## Workflow

1. Branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Keep changes small. One milestone task per PR.
3. Run `pnpm check` locally (lint, typecheck, format, unit tests).
4. Open a PR. CI must be green (lint, typecheck, unit + coverage, integration, production build + smoke, Docker build + container smoke, CodeQL, secret scan, dependency review).
5. Database changes: edit `src/server/platform/db/schema.ts`, run `pnpm db:generate`, **review the generated SQL**, and commit it.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`).

## AI-assisted development policy

AI coding assistants are used in this project. Rules:

- **AI output is a draft, not an authority.** Every AI-generated change must pass typecheck, lint, and tests, and get human review, before it is committed.
- **Verify against official docs.** Framework APIs change quickly (e.g. Next.js 16 renamed Middleware to Proxy). Check the docs bundled in `node_modules/next/dist/docs/` or official sites rather than relying on model memory.
- **Never paste secrets, credentials, or real customer data into AI tools.**
- **Tests must test behaviour, not mirror the implementation.** Review AI-written tests for meaningful assertions.
- Material AI use in a PR (e.g. generated test data) is noted in the PR description.

## Code structure rules

- Route handlers stay thin: they call services in `src/server/modules/*`. A lint rule forbids importing the DB layer from `src/app` (health probe excepted).
- Every tenant-scoped query takes a `workspaceId` (see `docs/03-threat-model.md` T1).
- Errors: throw `AppError` (see `src/server/platform/errors.ts`). Never return raw error messages to clients.
- Logs: use `logger`. Never log secrets, tokens, or message bodies (redaction is a safety net, not a licence).
