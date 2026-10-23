ALTER TABLE "workspace_settings" ALTER COLUMN "retrieval_min_score" SET DEFAULT 0.62;
-- M6 threshold analysis (docs/eval/refusal-threshold.md): new workspaces start at 0.62.
-- Existing rows are left alone on purpose: since M5 step 5 admins can set this on the
-- Settings page, so a stored 0.65 may be a deliberate choice.
