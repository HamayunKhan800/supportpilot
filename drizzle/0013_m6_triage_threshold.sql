ALTER TABLE "workspace_settings" ALTER COLUMN "triage_confidence_threshold" SET DEFAULT 0.95;
-- M6 Gemini baseline (docs/eval/m6-baseline.md, finding 1): new workspaces start at 0.95.
-- Existing rows are left alone on purpose, as in 0011: admins can set this on the AI settings
-- page, so a stored 0.7 may be a deliberate choice.
