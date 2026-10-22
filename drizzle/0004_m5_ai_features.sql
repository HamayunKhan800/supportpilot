CREATE TABLE "ai_daily_calls" (
	"day" date NOT NULL,
	"scope" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_daily_calls_day_scope_pk" PRIMARY KEY("day","scope"),
	CONSTRAINT "ai_daily_calls_calls_ck" CHECK ("ai_daily_calls"."calls" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"requested_by" text,
	"status" text DEFAULT 'generating' NOT NULL,
	"error_code" text,
	"body" text DEFAULT '' NOT NULL,
	"language" text,
	"model" text,
	"prompt_version" text NOT NULL,
	"retrieval_top_score" real,
	"invalid_citation_count" integer DEFAULT 0 NOT NULL,
	"warnings" text[] DEFAULT '{}'::text[] NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"est_cost_micros" integer DEFAULT 0 NOT NULL,
	"ttft_ms" integer,
	"latency_ms" integer,
	"sent_message_id" uuid,
	"edit_ratio" real,
	"feedback" text,
	"feedback_note" text,
	"feedback_by" text,
	"feedback_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_draft_id_workspace_uq" UNIQUE("id","workspace_id"),
	CONSTRAINT "ai_draft_status_ck" CHECK (status IN ('generating', 'ready', 'refused', 'blocked', 'failed', 'aborted', 'sent', 'discarded')),
	CONSTRAINT "ai_draft_feedback_ck" CHECK (feedback IS NULL OR feedback IN ('up', 'down')),
	CONSTRAINT "ai_draft_failed_has_reason_ck" CHECK ("ai_draft"."status" NOT IN ('failed', 'blocked') OR "ai_draft"."error_code" IS NOT NULL),
	CONSTRAINT "ai_draft_sent_has_edit_ratio_ck" CHECK ("ai_draft"."status" <> 'sent' OR "ai_draft"."edit_ratio" IS NOT NULL),
	CONSTRAINT "ai_draft_language_ck" CHECK ("ai_draft"."language" IS NULL OR "ai_draft"."language" ~ '^[a-z]{2}$'),
	CONSTRAINT "ai_draft_edit_ratio_ck" CHECK ("ai_draft"."edit_ratio" IS NULL OR ("ai_draft"."edit_ratio" >= 0 AND "ai_draft"."edit_ratio" <= 1)),
	CONSTRAINT "ai_draft_counts_ck" CHECK ("ai_draft"."invalid_citation_count" >= 0 AND "ai_draft"."input_tokens" >= 0 AND "ai_draft"."output_tokens" >= 0 AND "ai_draft"."est_cost_micros" >= 0 AND ("ai_draft"."ttft_ms" IS NULL OR "ai_draft"."ttft_ms" >= 0) AND ("ai_draft"."latency_ms" IS NULL OR "ai_draft"."latency_ms" >= 0)),
	CONSTRAINT "ai_draft_feedback_note_len_ck" CHECK ("ai_draft"."feedback_note" IS NULL OR char_length("ai_draft"."feedback_note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "ai_draft_citation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"draft_id" uuid NOT NULL,
	"marker" integer NOT NULL,
	"chunk_id" uuid,
	"document_id" uuid,
	"document_title" text NOT NULL,
	"heading_path" text DEFAULT '' NOT NULL,
	"content" text NOT NULL,
	"similarity" real,
	CONSTRAINT "ai_draft_citation_marker_ck" CHECK ("ai_draft_citation"."marker" BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE TABLE "ticket_triage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"model" text,
	"prompt_version" text,
	"category" text,
	"priority" text,
	"sentiment" text,
	"language" text,
	"confidence" real,
	"reason" text,
	"applied_category" boolean DEFAULT false NOT NULL,
	"applied_priority" boolean DEFAULT false NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"category_override" text,
	"priority_override" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_triage_status_ck" CHECK (status IN ('succeeded', 'failed', 'skipped')),
	CONSTRAINT "ticket_triage_priority_ck" CHECK (priority IS NULL OR priority IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "ticket_triage_priority_override_ck" CHECK (priority_override IS NULL OR priority_override IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "ticket_triage_sentiment_ck" CHECK (sentiment IS NULL OR sentiment IN ('negative', 'neutral', 'positive')),
	CONSTRAINT "ticket_triage_language_ck" CHECK ("ticket_triage"."language" IS NULL OR "ticket_triage"."language" ~ '^[a-z]{2}$'),
	CONSTRAINT "ticket_triage_confidence_ck" CHECK ("ticket_triage"."confidence" IS NULL OR ("ticket_triage"."confidence" >= 0 AND "ticket_triage"."confidence" <= 1)),
	CONSTRAINT "ticket_triage_reason_len_ck" CHECK ("ticket_triage"."reason" IS NULL OR char_length("ticket_triage"."reason") <= 200),
	CONSTRAINT "ticket_triage_succeeded_complete_ck" CHECK ("ticket_triage"."status" <> 'succeeded' OR ("ticket_triage"."category" IS NOT NULL AND "ticket_triage"."priority" IS NOT NULL AND "ticket_triage"."sentiment" IS NOT NULL AND "ticket_triage"."language" IS NOT NULL AND "ticket_triage"."confidence" IS NOT NULL AND "ticket_triage"."model" IS NOT NULL AND "ticket_triage"."prompt_version" IS NOT NULL)),
	CONSTRAINT "ticket_triage_unsuccessful_has_reason_ck" CHECK ("ticket_triage"."status" = 'succeeded' OR "ticket_triage"."error_code" IS NOT NULL),
	CONSTRAINT "ticket_triage_latency_ck" CHECK ("ticket_triage"."latency_ms" IS NULL OR "ticket_triage"."latency_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "outcome" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "ttft_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_draft" ADD CONSTRAINT "ai_draft_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_draft" ADD CONSTRAINT "ai_draft_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_draft" ADD CONSTRAINT "ai_draft_sent_message_id_ticket_message_id_fk" FOREIGN KEY ("sent_message_id") REFERENCES "public"."ticket_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_draft" ADD CONSTRAINT "ai_draft_feedback_by_user_id_fk" FOREIGN KEY ("feedback_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_draft" ADD CONSTRAINT "ai_draft_ticket_same_workspace_fk" FOREIGN KEY ("ticket_id","workspace_id") REFERENCES "public"."ticket"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_draft_citation" ADD CONSTRAINT "ai_draft_citation_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_draft_citation" ADD CONSTRAINT "ai_draft_citation_chunk_id_kb_chunk_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."kb_chunk"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_draft_citation" ADD CONSTRAINT "ai_draft_citation_document_id_kb_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_draft_citation" ADD CONSTRAINT "ai_draft_citation_draft_same_workspace_fk" FOREIGN KEY ("draft_id","workspace_id") REFERENCES "public"."ai_draft"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_triage" ADD CONSTRAINT "ticket_triage_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_triage" ADD CONSTRAINT "ticket_triage_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_triage" ADD CONSTRAINT "ticket_triage_ticket_same_workspace_fk" FOREIGN KEY ("ticket_id","workspace_id") REFERENCES "public"."ticket"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_draft_ticket_created_idx" ON "ai_draft" USING btree ("ticket_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_draft_workspace_created_idx" ON "ai_draft" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ai_draft_citation_draft_marker_uq" ON "ai_draft_citation" USING btree ("draft_id","marker");--> statement-breakpoint
CREATE INDEX "ticket_triage_ticket_created_idx" ON "ticket_triage" USING btree ("ticket_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ticket_triage_open_review_idx" ON "ticket_triage" USING btree ("workspace_id","ticket_id") WHERE "ticket_triage"."needs_review" AND "ticket_triage"."reviewed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_ticket_idx" ON "ai_usage" USING btree ("ticket_id");--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_outcome_ck" CHECK (outcome IN ('ok', 'refused', 'blocked', 'invalid', 'timeout', 'error', 'aborted'));--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_timing_ck" CHECK (("ai_usage"."latency_ms" IS NULL OR "ai_usage"."latency_ms" >= 0) AND ("ai_usage"."ttft_ms" IS NULL OR "ai_usage"."ttft_ms" >= 0));