import type { BusinessConfig } from "../config/schema.js";
import type { LLMProvider } from "../llm/types.js";
import type { AuditLog } from "../ports/audit-log.js";
import type { Calendar } from "../ports/calendar.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/ids.js";
import type { Mailer } from "../ports/mailer.js";
import type { SessionStore } from "../ports/session-store.js";
import type { SlotLock } from "../ports/slot-lock.js";

export interface GateDeps {
  config: BusinessConfig;
  calendar: Calendar;
  clock: Clock;
  sessions: SessionStore;
  audit: AuditLog;
  locks: SlotLock;
  mailer: Mailer;
  ids: IdGenerator;
  llm: LLMProvider;
}

export const PENDING_TTL_MS = 300_000;
export const SLOT_LOCK_TTL_MS = 10_000;
