/**
 * The owner api's responses (apps/api/src/owner/*, packages/db/src/owner/*). Mirrored here
 * because the web app talks to the api over HTTP and never imports server packages.
 */
export type OwnerSource = "live" | "pilot";

export interface ConversationSummary {
  id: string;
  source: OwnerSource;
  seeded: boolean;
  startedAt: string;
  endedAt: string | null;
  outcome: string | null;
  handoffReason: string | null;
  turnCount: number;
  lastCallerText: string | null;
  booked: boolean;
  costUsd: number;
}

export interface ToolCall {
  name: string;
  ms: number;
  ok: boolean;
}

export interface TurnRecord {
  id: string;
  turnIndex: number;
  callerText: string;
  agentText: string;
  sttMs: number | null;
  llmTtftMs: number | null;
  llmTotalMs: number | null;
  toolMs: number[];
  toolCalls: ToolCall[];
  ttsStartMs: number | null;
  firstOutputMs: number | null;
  totalMs: number | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  flags: string[];
  createdAt: string;
}

export type AuditStage =
  "proposed" | "confirmed" | "executed" | "failed" | "voided" | "email_sent" | "email_failed";

export interface AuditRow {
  seq: number;
  at: string;
  sessionId: string;
  turnId: string | null;
  actionId: string;
  kind: "book" | "reschedule" | "cancel";
  stage: AuditStage;
  args: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  reason: string | null;
}

export interface TranscriptEntry {
  role: "caller" | "agent";
  text: string;
  turnId: string;
}

export interface HandoffRow {
  id: string;
  sessionId: string;
  source: OwnerSource;
  seeded: boolean;
  reason: string;
  summary: string;
  transcript: TranscriptEntry[];
  createdAt: string;
  resolvedAt: string | null;
  notes: string | null;
  outcome: string | null;
  /** Who the guest is and what they asked for (older tickets: null). */
  details: HandoffDetails | null;
}

/** core's HandoffDetails: every field only when the session knew it. */
export interface HandoffDetails {
  name?: string;
  contact?: string;
  date?: string;
  time?: string;
  partySize?: number;
}

export interface FeedbackRow {
  conversationId: string;
  rating: number | null;
  comment: string;
  createdAt: string;
  seeded: boolean;
}

export interface ConversationDetail {
  summary: ConversationSummary;
  turns: TurnRecord[];
  audit: AuditRow[];
  handoff: HandoffRow | null;
}

export interface BookingRow {
  actionId: string;
  sessionId: string;
  seeded: boolean;
  kind: "book" | "reschedule" | "cancel";
  status: "booked" | "rescheduled" | "cancelled";
  reservationId: string;
  name: string;
  contact: string;
  partySize: number;
  start: string;
  end: string;
  executedAt: string;
  emailed: boolean | null;
  voice: boolean;
  calendarUrl: string | null;
}

export type Stage = "stt" | "llmTtft" | "tool" | "ttsStart" | "firstOutput";
export interface Percentiles {
  p50: number | null;
  p95: number | null;
}

export interface DailyMetrics {
  day: string;
  conversations: number;
  taskSuccessRate: number | null;
  handoffRate: number | null;
  p50FirstOutputMs: number | null;
  p95FirstOutputMs: number | null;
  avgTokens: number | null;
  avgCostUsd: number | null;
}

export interface MetricsReport {
  summary: {
    conversations: number;
    taskSuccessRate: number | null;
    handoffRate: number | null;
    avgTokens: number | null;
    avgCostUsd: number | null;
    latency: Record<Stage, Percentiles>;
    feedback: { avgRating: number | null; count: number };
    handoffOutcomes: Record<string, number>;
    /** Calendar writes with no confirmation before them; the gate keeps this at 0. */
    unsafeActions: number;
  };
  daily: DailyMetrics[];
  hasSeeded: boolean;
  budget: Record<Stage, { p50: number; p95: number }>;
}

export interface LiveSession {
  sessionId: string;
  startedAt: string;
  turnCount: number;
  lastCallerText: string | null;
  lastAgentText: string | null;
  pending: { summary: string; expiresAt: string } | null;
  handedOff: boolean;
}

export type LiveEvent =
  | { type: "session_open" | "session_closed"; sessionId: string; at: string }
  | {
      type: "turn";
      sessionId: string;
      turnId: string;
      callerText: string;
      agentText: string;
      firstOutputMs: number | null;
      flags: string[];
      at: string;
    }
  | { type: "pending"; sessionId: string; summary: string; expiresAt: string }
  | { type: "pending_cleared"; sessionId: string; status: "executed" | "failed" | "voided" }
  | { type: "handoff"; sessionId: string; reason: string };

/** One reservation on the owner's calendar (GET /owner/calendar). */
export interface CalendarReservation {
  id: string;
  tableId: string;
  partySize: number;
  name: string;
  contact: string;
  start: string;
  end: string;
  /** Minutes since local midnight. */
  startMinute: number;
  endMinute: number;
  startLabel: string;
  endLabel: string;
  /** The conversation that booked it; null when Front Desk has no log of it. */
  sessionId: string | null;
  voice: boolean | null;
  bookedAt: string | null;
  emailed: boolean | null;
  calendarUrl: string | null;
}

export interface CalendarDay {
  date: string;
  today: string;
  label: string;
  open: boolean;
  hours: { open: string; close: string }[];
  tables: { id: string; size: number }[];
  seats: number;
  reservations: CalendarReservation[];
  week: { date: string; label: string; open: boolean; bookings: number; guests: number }[];
}
