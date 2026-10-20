-- Custom SQL migration: enable pgvector (ADR-0002).
-- On managed providers (e.g. Neon) the app role may create this extension;
-- locally the docker image / setup script pre-installs it. IF NOT EXISTS keeps this idempotent.
CREATE EXTENSION IF NOT EXISTS vector;
