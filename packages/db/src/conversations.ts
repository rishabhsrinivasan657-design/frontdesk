import { asc, eq } from "drizzle-orm";
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
  totalMs: number | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** e.g. injection patterns flagged by the guardrails (spec §6). */
  flags: string[];
  createdAt: string;
}

/** Conversations, turns and feedback. Bookings are never stored here: Calendar owns them. */
export class PgConversations {
  constructor(private readonly db: Db) {}

  async start(c: { id: string; source: ConversationSource; startedAt: string }): Promise<void> {
    await this.db.insert(conversations).values(c);
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
