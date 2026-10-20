# ADR-0010 · Node.js 24 LTS runtime

Status: Accepted · Date: 2026-10-20

## Context

The development sandbox shipped Node 20. The official Node.js release schedule (github.com/nodejs/Release, checked 2026-10-20) shows **Node 20 reached end-of-life on 2026-04-30** and gets no more security fixes. Node 24 is LTS until 2028-04-30. Node 26 becomes LTS on 2026-10-28.

## Decision

Use Node 24 LTS everywhere: `.nvmrc`, `engines`, CI (`setup-node` reads `.nvmrc`), and the Docker base image `node:24.22.0-trixie-slim`.

## Consequences

- Supported runtime with security patches. Next.js 16 requires Node ≥ 20.9.
  − Re-evaluate Node 26 after it has been LTS for a few months and the ecosystem (Next.js, pg, pino) has confirmed support. Dependabot will propose base-image updates.
