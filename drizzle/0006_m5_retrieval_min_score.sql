ALTER TABLE "workspace_settings" ALTER COLUMN "retrieval_min_score" SET DEFAULT 0.65;--> statement-breakpoint
-- M5 D7 / finding #87: move workspaces still on M2's placeholder (0.5) to the measured value.
-- No UI can set this column before M5 step 5, so 0.5 always means "never chosen".
UPDATE "workspace_settings" SET "retrieval_min_score" = 0.65 WHERE "retrieval_min_score" = 0.5;
