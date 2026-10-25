ALTER TABLE "conversations" ADD COLUMN "seeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "first_output_ms" integer;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL;