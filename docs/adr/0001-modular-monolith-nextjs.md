# ADR-0001 · Modular monolith on Next.js 16 (App Router)
Status: Accepted · Date: 2026-10-19

## Context
One developer and a portfolio app at demo scale. It must show full-stack skill and be cheap to run.

## Decision
A single TypeScript codebase on Next.js 16 + React 19 (Node.js LTS runtime). It provides UI, REST route handlers and auth. A second process type (`worker`) from the same image runs background jobs. Domain modules (`tickets`, `kb`, `ai`, `workspaces`, `analytics`) live in `src/server/modules`, and lint rules enforce the boundaries.

## Alternatives
- Separate API service (NestJS/FastAPI) + SPA: more deployables and duplicated types, with no benefit at this scale.
- Microservices: operational cost far outweighs the benefit for one developer.

## Consequences
+ Shared types end-to-end, one deploy pipeline. − Next.js releases frequent security patches (monthly in 2026), so automated dependency updates are mandatory. − Must stay disciplined about module boundaries; they could be split into services later if needed.
