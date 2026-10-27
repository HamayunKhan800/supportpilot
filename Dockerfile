# syntax=docker/dockerfile:1
# SupportPilot production image (ADR-0008): multi-stage, minimal runtime, non-root.
# Base image is written literally (not via ARG) so Dependabot can see and update it:
# Dependabot's Dockerfile parser skips FROM lines that use ${VARIABLES}
# (dependabot-core#4597, #2057). Pinned by digest for reproducible, tamper-evident
# builds (OWASP A03 supply chain). Stays on Node 24 LTS (ADR-0010). Keep both FROMs identical.

# ---- base: shared tooling ------------------------------------------------------
FROM node:24.22.0-trixie-slim@sha256:a6155384446670e9719bdc4fd0ebe4d4b29fb32a8d6aa523da3547a6cfbcf22c AS base
ENV PNPM_HOME=/pnpm \
    NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# ---- deps: install from the lockfile only (reproducible, cached) ----------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build: Next.js standalone output + bundled worker and CLI scripts -----------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build && pnpm build:scripts

# ---- runner: only what is needed at runtime --------------------------------------
FROM node:24.22.0-trixie-slim@sha256:a6155384446670e9719bdc4fd0ebe4d4b29fb32a8d6aa523da3547a6cfbcf22c AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# App files are owned by root and read-only for the runtime user. Only the
# Next.js cache directory is writable.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/.build ./.build
COPY --from=build /app/drizzle ./drizzle
# The synthetic help centre, read by the demo seed (node .build/seed-demo.mjs [--reset]).
COPY --from=build /app/eval/corpus/nimbus ./eval/corpus/nimbus
# Only /tmp is writable on AWS Lambda, so the Next.js cache lives there through a link. The
# folder is made here for plain Docker runs; on Lambda /tmp starts empty and the launcher
# (node .build/start.mjs) creates it.
RUN mkdir -p /tmp/next-cache && chown 1000:1000 /tmp/next-cache \
    && rm -rf .next/cache && ln -s /tmp/next-cache .next/cache

# AWS Lambda Web Adapter (plan M8 revision 2, R3): a Lambda extension that turns Lambda
# invocations into HTTP requests to the app. It only starts inside Lambda; anywhere else it
# is an unused file. Multi-arch image, pinned by digest (v1.1.0, checked 2026-10-27).
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0@sha256:17cfd08eff1dfea3f6a9a1e9c65fdac80aa4919b6085e746615530f43f57d2f1 /lambda-adapter /opt/extensions/lambda-adapter

# Unprivileged "node" user from the official image, by numeric UID so
# orchestrators (e.g. Kubernetes runAsNonRoot) can verify it is not root.
USER 1000:1000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Commands, one image:
#   web (default):  node server.js
#   worker:         node .build/worker.mjs   (run with --no-healthcheck: the check probes the web port)
#   web + worker:   node .build/start.mjs    (one container runs both; plan M8 D2)
#   Lambda web:     node .build/start.mjs web   (secrets from SSM; plan M8 revision 2)
#   Lambda worker:  node .build/start.mjs jobs  (drain / migrate / seed-reset events)
#   release step:   node .build/migrate.mjs  (SQL migrations + job queues, before new code serves traffic)
#   demo data:      node .build/seed-demo.mjs [--reset]  (needs DEMO_PASSWORD and ALLOW_DEMO_SEED=true)
CMD ["node", "server.js"]
