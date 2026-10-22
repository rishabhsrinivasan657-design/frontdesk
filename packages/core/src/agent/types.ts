import type { Slot } from "../availability/types.js";
import { HANDOFF_TRIGGERS } from "../config/schema.js";
import type { LLMMessage } from "../llm/types.js";
import type { Booking } from "../ports/calendar.js";

export type ActionKind = "book" | "reschedule" | "cancel";

export type ActionArgs =
  | {
      kind: "book";
      slotId: string;
      name: string;
      contact: string;
      partySize: number;
      notes: string;
    }
  | { kind: "reschedule"; reservationId: string; slotId: string }
  | { kind: "cancel"; reservationId: string };

/** A validated write waiting for the caller's confirmation (spec §6 gate step 1). */
export interface PendingAction {
  id: string;
  sessionId: string;
  args: ActionArgs;
  /** The deterministic read-back the caller confirms. */
  summary: string;
  slot?: Slot;
  reservation?: Booking;
  proposedTurn: number;
  /** ISO 8601. */
  expiresAt: string;
}

export const HANDOFF_REASONS = [
  ...HANDOFF_TRIGGERS,
  "low_confidence",
  "tool_failures",
  "grounding_failed",
  "rate_limited",
  "llm_unavailable",
  "calendar_unavailable",
] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

export interface TranscriptEntry {
  role: "caller" | "agent";
  text: string;
  turnId: string;
}

export interface SessionState {
  id: string;
  createdAt: string;
  turn: number;
  history: LLMMessage[];
  transcript: TranscriptEntry[];
  /** Slots check_availability returned this session, by id (slot provenance, spec §5). */
  offeredSlots: Record<string, Slot>;
  /** Bookings find_reservation returned this session, by id (reservation provenance). */
  knownReservations: Record<string, Booking>;
  /** Values the caller stated, normalized; grounding treats echoes as grounded. */
  callerValues: string[];
  counters: { offTopic: number; toolFailuresInARow: number };
  humanOffered: boolean;
  handoff?: { reason: HandoffReason; at: string };
}

export type AuditStage = "proposed" | "confirmed" | "executed" | "failed" | "voided";

export interface AuditEvent {
  at: string;
  sessionId: string;
  turnId: string;
  actionId: string;
  kind: ActionKind;
  stage: AuditStage;
  args: ActionArgs;
  result?: unknown;
  reason?: string;
}

export interface HandoffTicket {
  id: string;
  sessionId: string;
  reason: HandoffReason;
  summary: string;
  transcript: TranscriptEntry[];
  createdAt: string;
}

export function newSession(id: string, now: Date): SessionState {
  return {
    id,
    createdAt: now.toISOString(),
    turn: 0,
    history: [],
    transcript: [],
    offeredSlots: {},
    knownReservations: {},
    callerValues: [],
    counters: { offTopic: 0, toolFailuresInARow: 0 },
    humanOffered: false,
  };
}
