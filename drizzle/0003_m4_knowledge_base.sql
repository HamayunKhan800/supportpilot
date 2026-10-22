CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"est_cost_micros" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_feature_ck" CHECK (feature IN ('triage', 'draft', 'embed')),
	CONSTRAINT "ai_usage_tokens_ck" CHECK ("ai_usage"."input_tokens" >= 0 AND "ai_usage"."output_tokens" >= 0 AND "ai_usage"."est_cost_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "kb_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"heading_path" text DEFAULT '' NOT NULL,
	"content" text NOT NULL,
	"token_estimate" integer NOT NULL,
	"embedding" vector(768) NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, heading_path), 'A') || setweight(to_tsvector('english'::regconfig, content), 'B')) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_chunk_ordinal_ck" CHECK ("kb_chunk"."ordinal" >= 0),
	CONSTRAINT "kb_chunk_token_estimate_ck" CHECK ("kb_chunk"."token_estimate" > 0)
);
--> statement-breakpoint
CREATE TABLE "kb_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"page_count" integer,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"token_estimate" integer DEFAULT 0 NOT NULL,
	"embedding_model" text,
	"uploaded_by" text,
	"ingested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_document_id_workspace_uq" UNIQUE("id","workspace_id"),
	CONSTRAINT "kb_document_status_ck" CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
	CONSTRAINT "kb_document_mime_type_ck" CHECK (mime_type IN ('text/markdown', 'text/plain', 'application/pdf')),
	CONSTRAINT "kb_document_size_ck" CHECK ("kb_document"."size_bytes" > 0),
	CONSTRAINT "kb_document_sha256_ck" CHECK ("kb_document"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "kb_document_failed_has_reason_ck" CHECK ("kb_document"."status" <> 'failed' OR "kb_document"."error_code" IS NOT NULL),
	CONSTRAINT "kb_document_ready_has_model_ck" CHECK ("kb_document"."status" <> 'ready' OR "kb_document"."embedding_model" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "kb_document_blob" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunk" ADD CONSTRAINT "kb_chunk_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunk" ADD CONSTRAINT "kb_chunk_document_same_workspace_fk" FOREIGN KEY ("document_id","workspace_id") REFERENCES "public"."kb_document"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_document" ADD CONSTRAINT "kb_document_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_document" ADD CONSTRAINT "kb_document_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_document_blob" ADD CONSTRAINT "kb_document_blob_document_id_kb_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_workspace_created_idx" ON "ai_usage" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "kb_chunk_document_ordinal_uq" ON "kb_chunk" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE INDEX "kb_chunk_workspace_idx" ON "kb_chunk" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "kb_chunk_embedding_hnsw_idx" ON "kb_chunk" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "kb_chunk_tsv_idx" ON "kb_chunk" USING gin ("tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_document_workspace_sha256_uq" ON "kb_document" USING btree ("workspace_id","sha256");--> statement-breakpoint
CREATE INDEX "kb_document_workspace_created_idx" ON "kb_document" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);