# ADR-0008 · Low-cost container deployment

Status: Accepted; platform choice replaced by [ADR-0021](0021-aws-lambda-deployment.md) (AWS Lambda, two functions from this one image) · Date: 2026-10-19

## Decision

Ship one multi-stage Docker image (non-root, Next.js standalone output) run as `web` and `worker` services on a low-cost container platform (candidates: Fly.io, Render, Railway), with managed Postgres + pgvector (candidate: Neon). GitHub Actions builds, scans, migrates and deploys, then runs a post-deploy smoke test.

## Why

It keeps a live demo up at near-zero cost. Docker keeps it portable to AWS ECS/Kubernetes later, and the README will document that path.

## Consequences

− Less AWS-specific signal than ECS + Terraform. − Free tiers change often; current limits are checked against official pricing pages at M8, not assumed.
