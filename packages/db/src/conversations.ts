import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { conversations, feedback, turns } from "./schema.js";
import { iso } from "./time.js";

export type ConversationSource = "live" | "pilot" | "eval";

/** One turn's record (spec §8). Times are ISO 8601; latencies are whole milliseconds. */
export interface TurnRecord {
  id: string;
  conversationId: string;
  turnIndex: number;
  callerText: string;
  agentText: string;
  sttMs: number | null;
  llmTtftMs: number | null;
  llmTotalMs: number | null;
  toolMs: number[];
  ttsStartMs: number | null;
  firstOutputMs: number | null;
  totalMs: number | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** Tool name, whole ms and success, in call order (no args). */
  toolCalls: { name: string; ms: number; ok: boolean }[];
  /** e.g. injection patterns flagged by the guardrails (spec §6). */
  flags: string[];
  createdAt: string;
}

/** Conversations, turns and feedback. Bookings are never stored here: Calendar owns them. */
export class PgConversations {
  constructor(private readonly db: Db) {}

  /** Idempotent: a second start for the same id keeps the first row. */
  async start(c: { id: string; source: ConversationSource; startedAt: string }): Promise<void> {
    await this.db.insert(conversations).values(c).onConflictDoNothing();
  }

  async end(
    id: string,
    e: { endedAt: string; outcome: string; handoffReason?: string },
  ): Promise<void> {
    await this.db
      .update(conversations)
      .set({ endedAt: e.endedAt, outcome: e.outcome, handoffReason: e.handoffReason ?? null })
      .where(eq(conversations.id, id));
  }

  async recordTurn(t: TurnRecord): Promise<void> {
    await this.db.insert(turns).values(t);
  }

  /** Fills tts_start_ms (and appends flags) once: a turn that already has one is left alone. */
  async setTtsStart(
    conversationId: string,
    turnId: string,
    ms: number,
    flags: string[],
  ): Promise<void> {
    await this.db
      .update(turns)
      .set({
        ttsStartMs: ms,
        flags: sql`${turns.flags} || ${JSON.stringify(flags)}::jsonb`,
      })
      .where(
        and(
          eq(turns.id, turnId),
          eq(turns.conversationId, conversationId),
          isNull(turns.ttsStartMs),
        ),
      );
  }

  async turns(conversationId: string): Promise<TurnRecord[]> {
    const rows = await this.db
      .select()
      .from(turns)
      .where(eq(turns.conversationId, conversationId))
      .orderBy(asc(turns.turnIndex));
    return rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) }));
  }

  async addFeedback(f: {
    id: string;
    conversationId?: string;
    rating?: number;
    comment: string;
    createdAt: string;
  }): Promise<void> {
    await this.db.insert(feedback).values(f);
  }
}
