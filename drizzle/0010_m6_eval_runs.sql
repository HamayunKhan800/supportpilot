CREATE TABLE "eval_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"suite" text NOT NULL,
	"item_key" text NOT NULL,
	"passed" boolean NOT NULL,
	"failed" boolean DEFAULT false NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_item_suite_ck" CHECK (suite IN ('retrieval', 'triage', 'draft', 'injection')),
	CONSTRAINT "eval_item_key_ck" CHECK (item_key ~ '^[A-Za-z0-9-]{1,40}$'),
	CONSTRAINT "eval_item_failed_ck" CHECK (NOT ("eval_item"."failed" AND "eval_item"."passed"))
);
--> statement-breakpoint
CREATE TABLE "eval_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"dataset_hash" text NOT NULL,
	"config_hash" text NOT NULL,
	"config" jsonb NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"stop_reason" text,
	"summary" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "eval_run_provider_ck" CHECK (provider IN ('mock', 'gemini')),
	CONSTRAINT "eval_run_status_ck" CHECK (status IN ('running', 'stopped', 'completed')),
	CONSTRAINT "eval_run_dataset_hash_ck" CHECK ("eval_run"."dataset_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "eval_run_config_hash_ck" CHECK ("eval_run"."config_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "eval_run_calls_ck" CHECK ("eval_run"."calls" >= 0),
	CONSTRAINT "eval_run_finished_ck" CHECK (("eval_run"."status" = 'completed') = ("eval_run"."finished_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "eval_item" ADD CONSTRAINT "eval_item_run_id_eval_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_item_run_suite_key_uq" ON "eval_item" USING btree ("run_id","suite","item_key");--> statement-breakpoint
CREATE INDEX "eval_run_started_idx" ON "eval_run" USING btree ("started_at");