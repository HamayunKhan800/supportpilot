CREATE TABLE "eval_review_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set" text NOT NULL,
	"item_key" text NOT NULL,
	"position" integer NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"verdict" text,
	"note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_review_item_set_ck" CHECK ("set" IN ('label-changes', 'triage-labels', 'retrieval-labels', 'drafts')),
	CONSTRAINT "eval_review_item_verdict_ck" CHECK (verdict IS NULL OR verdict IN ('agree', 'disagree')),
	CONSTRAINT "eval_review_item_reviewed_ck" CHECK (("eval_review_item"."verdict" IS NULL) = ("eval_review_item"."reviewed_at" IS NULL)),
	CONSTRAINT "eval_review_item_note_ck" CHECK ("eval_review_item"."note" IS NULL OR "eval_review_item"."verdict" IS NOT NULL),
	CONSTRAINT "eval_review_item_note_len_ck" CHECK (note IS NULL OR char_length(note) <= 500),
	CONSTRAINT "eval_review_item_hash_ck" CHECK ("eval_review_item"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "eval_review_item_key_ck" CHECK ("eval_review_item"."item_key" ~ '^[a-z0-9-]{1,40}$')
);
--> statement-breakpoint
ALTER TABLE "eval_review_item" ADD CONSTRAINT "eval_review_item_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_review_item_set_key_uq" ON "eval_review_item" USING btree ("set","item_key");--> statement-breakpoint
CREATE INDEX "eval_review_item_set_position_idx" ON "eval_review_item" USING btree ("set","position");