CREATE TABLE "audit_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"session_id" text NOT NULL,
	"turn_id" text,
	"action_id" text NOT NULL,
	"kind" text NOT NULL,
	"stage" text NOT NULL,
	"args" jsonb,
	"result" jsonb,
	"reason" text,
	CONSTRAINT "audit_log_kind_check" CHECK ("audit_log"."kind" in ('book', 'reschedule', 'cancel')),
	CONSTRAINT "audit_log_stage_check" CHECK ("audit_log"."stage" in ('proposed', 'confirmed', 'executed', 'failed', 'voided', 'email_sent', 'email_failed'))
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"outcome" text,
	"handoff_reason" text,
	CONSTRAINT "conversations_source_check" CHECK ("conversations"."source" in ('live', 'pilot', 'eval'))
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text,
	"rating" integer,
	"comment" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "feedback_rating_check" CHECK ("feedback"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"reason" text NOT NULL,
	"summary" text NOT NULL,
	"transcript" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"turn_index" integer NOT NULL,
	"caller_text" text NOT NULL,
	"agent_text" text NOT NULL,
	"stt_ms" integer,
	"llm_ttft_ms" integer,
	"llm_total_ms" integer,
	"tool_ms" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"tts_start_ms" integer,
	"total_ms" integer,
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "turns_conversation_turn_unique" UNIQUE("conversation_id","turn_index")
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "audit_log_session_idx" ON "audit_log" USING btree ("session_id");