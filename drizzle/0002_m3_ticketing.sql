CREATE TABLE "app_rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"number" integer NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"category" text,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"assignee_id" text,
	"access_token_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_tsv" "tsvector" DEFAULT ''::tsvector NOT NULL,
	CONSTRAINT "ticket_id_workspace_uq" UNIQUE("id","workspace_id"),
	CONSTRAINT "ticket_status_ck" CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
	CONSTRAINT "ticket_priority_ck" CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "ticket_number_positive_ck" CHECK ("ticket"."number" > 0)
);
--> statement-breakpoint
CREATE TABLE "ticket_counter" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"last_number" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "ticket_message_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_type" text NOT NULL,
	"author_user_id" text,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_message_internal_by_agent_ck" CHECK (NOT "ticket_message"."is_internal" OR "ticket_message"."author_type" = 'agent'),
	CONSTRAINT "ticket_message_author_type_ck" CHECK (author_type IN ('customer', 'agent', 'system'))
);
--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_counter" ADD CONSTRAINT "ticket_counter_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_message" ADD CONSTRAINT "ticket_message_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_message" ADD CONSTRAINT "ticket_message_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_message" ADD CONSTRAINT "ticket_message_ticket_same_workspace_fk" FOREIGN KEY ("ticket_id","workspace_id") REFERENCES "public"."ticket"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_workspace_number_uq" ON "ticket" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_access_token_hash_uq" ON "ticket" USING btree ("access_token_hash");--> statement-breakpoint
CREATE INDEX "ticket_workspace_created_idx" ON "ticket" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ticket_workspace_status_created_idx" ON "ticket" USING btree ("workspace_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ticket_workspace_assignee_idx" ON "ticket" USING btree ("workspace_id","assignee_id");--> statement-breakpoint
CREATE INDEX "ticket_search_idx" ON "ticket" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "ticket_message_ticket_seq_idx" ON "ticket_message" USING btree ("ticket_id","seq");--> statement-breakpoint
-- Hand-written (Drizzle cannot express a column-list SET NULL, PostgreSQL 15+).
-- An assignee must be a member of the ticket's workspace. When the membership is
-- deleted, only assignee_id is cleared; workspace_id is left intact.
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_assignee_is_member_fk" FOREIGN KEY ("workspace_id","assignee_id") REFERENCES "public"."member"("organization_id","user_id") ON DELETE SET NULL ("assignee_id") ON UPDATE no action;
