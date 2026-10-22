import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

const at = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

/** One caller session. `id` is core's session id. No booking data: Calendar owns that (spec §3). */
export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    startedAt: at("started_at").notNull(),
    endedAt: at("ended_at"),
    outcome: text("outcome"),
    handoffReason: text("handoff_reason"),
  },
  (t) => [check("conversations_source_check", sql`${t.source} in ('live', 'pilot', 'eval')`)],
);

/** One caller message and the agent's reply, with the per-turn record from spec §8. */
export const turns = pgTable(
  "turns",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    turnIndex: integer("turn_index").notNull(),
    callerText: text("caller_text").notNull(),
    agentText: text("agent_text").notNull(),
    sttMs: integer("stt_ms"),
    llmTtftMs: integer("llm_ttft_ms"),
    llmTotalMs: integer("llm_total_ms"),
    toolMs: integer("tool_ms")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    ttsStartMs: integer("tts_start_ms"),
    totalMs: integer("total_ms"),
    tokensIn: integer("tokens_in").notNull(),
    tokensOut: integer("tokens_out").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull(),
    flags: jsonb("flags").$type<string[]>().notNull().default([]),
    createdAt: at("created_at").notNull(),
  },
  (t) => [unique("turns_conversation_turn_unique").on(t.conversationId, t.turnIndex)],
);

/** Append-only: migration 0001 adds triggers that reject UPDATE, DELETE and TRUNCATE (spec §6). */
export const auditLog = pgTable(
  "audit_log",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    at: at("at").notNull(),
    sessionId: text("session_id").notNull(),
    turnId: text("turn_id"),
    actionId: text("action_id").notNull(),
    kind: text("kind").notNull(),
    stage: text("stage").notNull(),
    args: jsonb("args"),
    result: jsonb("result"),
    reason: text("reason"),
  },
  (t) => [
    check("audit_log_kind_check", sql`${t.kind} in ('book', 'reschedule', 'cancel')`),
    check(
      "audit_log_stage_check",
      sql`${t.stage} in ('proposed', 'confirmed', 'executed', 'failed', 'voided', 'email_sent', 'email_failed')`,
    ),
    index("audit_log_action_idx").on(t.actionId),
    index("audit_log_session_idx").on(t.sessionId),
  ],
);

/** The human review queue (spec §6 handoff). */
export const handoffs = pgTable("handoffs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  reason: text("reason").notNull(),
  summary: text("summary").notNull(),
  transcript: jsonb("transcript").notNull(),
  createdAt: at("created_at").notNull(),
  resolvedAt: at("resolved_at"),
  notes: text("notes"),
});

export const feedback = pgTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").references(() => conversations.id),
    rating: integer("rating"),
    comment: text("comment").notNull(),
    createdAt: at("created_at").notNull(),
  },
  (t) => [check("feedback_rating_check", sql`${t.rating} between 1 and 5`)],
);
