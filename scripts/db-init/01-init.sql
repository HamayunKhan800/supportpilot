-- Runs once on first start of the local docker-compose database (dev only).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE DATABASE supportpilot_test OWNER supportpilot;
\connect supportpilot_test
CREATE EXTENSION IF NOT EXISTS vector;
