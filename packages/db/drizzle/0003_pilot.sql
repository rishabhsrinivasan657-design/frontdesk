ALTER TABLE "feedback" ALTER COLUMN "conversation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "pii_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_conversation_unique" UNIQUE("conversation_id");--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_comment_length_check" CHECK (char_length("feedback"."comment") <= 1000);--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_outcome_check" CHECK ("handoffs"."outcome" in ('booked_by_staff', 'resolved_no_booking', 'caller_unreachable', 'not_needed'));--> statement-breakpoint
-- The retention job (M10) may redact args/result, and nothing else, inside a transaction that
-- sets frontdesk.retention = 'on'. Every other change is still rejected (spec §6).
CREATE OR REPLACE FUNCTION audit_log_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('frontdesk.retention', true) = 'on'
     AND NEW.seq = OLD.seq
     AND NEW.at = OLD.at
     AND NEW.session_id = OLD.session_id
     AND NEW.turn_id IS NOT DISTINCT FROM OLD.turn_id
     AND NEW.action_id = OLD.action_id
     AND NEW.kind = OLD.kind
     AND NEW.stage = OLD.stage
     AND NEW.reason IS NOT DISTINCT FROM OLD.reason THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only (% rejected)', TG_OP;
END;
$$;
