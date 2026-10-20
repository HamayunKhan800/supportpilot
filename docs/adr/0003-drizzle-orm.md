# ADR-0003 · Drizzle ORM + committed SQL migrations

Status: Accepted · Date: 2026-10-19

## Decision

Drizzle ORM for typed queries; drizzle-kit generates SQL migration files that are reviewed and committed. Production runs migrations as a release step.

## Why

SQL-first and fully typed, with native support for the pgvector column type and parameterized queries by default. Migrations are plain SQL, so they are easy to review in PRs.

## Alternatives

Prisma, the most widely known TypeScript ORM: pgvector requires `Unsupported` types and raw SQL. Raw SQL with a query builder (Kysely): viable, but carries more boilerplate.

## Consequences

- Readable SQL migrations. − Smaller ecosystem than Prisma. Raw SQL (`sql```) is only allowed with parameter binding, and a lint rule flags string concatenation.
