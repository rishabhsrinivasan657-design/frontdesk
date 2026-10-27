-- The retention job (M10) also redacts `reason` (an email error can quote the address).
-- Still only inside a transaction that sets frontdesk.retention = 'on'; every other change to
-- audit_log, and every DELETE or TRUNCATE, is rejected (spec §6).
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
     AND NEW.stage = OLD.stage THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only (% rejected)', TG_OP;
END;
$$;
