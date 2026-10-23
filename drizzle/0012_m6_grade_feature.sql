-- M6 step 3: the evaluation's groundedness grader records its usage as feature 'grade'.
-- The app never calls it; Settings and the API report only triage, draft and embed.
ALTER TABLE "ai_usage" DROP CONSTRAINT "ai_usage_feature_ck";--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_feature_ck" CHECK (feature IN ('triage', 'draft', 'embed', 'grade'));
