# ADR-0005 · pg-boss for background jobs
Status: Accepted · Date: 2026-10-19

## Decision
Use pg-boss (a Postgres-backed queue) for `ticket.triage` and `kb.ingest` jobs, with retries, exponential backoff and concurrency limits, consumed by the `worker` process.

## Why
No Redis to run or pay for. Jobs can be enqueued **in the same transaction** as the business write (no lost jobs).

## Alternatives
BullMQ + Redis: popular, but adds infrastructure. Vercel/Inngest-style hosted queues: vendor lock-in.

## Consequences
+ Simple infrastructure. − Queue throughput is bounded by Postgres (more than sufficient here).
