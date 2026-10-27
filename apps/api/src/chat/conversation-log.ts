import type { HandoffReason } from "@frontdesk/core";
import type { TurnRecord } from "@frontdesk/db";

export interface ConversationStart {
  id: string;
  source: "live" | "pilot";
  startedAt: string;
}

export interface ConversationEnd {
  endedAt: string;
  outcome: string;
  handoffReason?: HandoffReason;
}

/** Where conversations and their turns are stored (spec §3). `PgConversations` satisfies it. */
export interface ConversationLog {
  /** Idempotent: starting a conversation that exists does nothing. */
  start(c: ConversationStart): Promise<void>;
  recordTurn(t: TurnRecord): Promise<void>;
  /** Fills a stored turn's tts_start_ms (and adds flags) unless it already has one. */
  setTtsStart(conversationId: string, turnId: string, ms: number, flags: string[]): Promise<void>;
  end(id: string, e: ConversationEnd): Promise<void>;
  /** One rating per conversation (spec §12); a conversation with no stored turn can't be rated. */
  saveFeedback(f: Feedback): Promise<"saved" | "duplicate" | "no_conversation">;
}

export interface Feedback {
  id: string;
  conversationId: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export class InMemoryConversationLog implements ConversationLog {
  readonly started: ConversationStart[] = [];
  readonly turns: TurnRecord[] = [];
  readonly ended: (ConversationEnd & { id: string })[] = [];
  readonly feedback: Feedback[] = [];
  readonly ttsStarts: { conversationId: string; turnId: string; ms: number; flags: string[] }[] =
    [];

  start(c: ConversationStart): Promise<void> {
    if (!this.started.some((s) => s.id === c.id)) this.started.push(c);
    return Promise.resolve();
  }

  recordTurn(t: TurnRecord): Promise<void> {
    this.turns.push(t);
    return Promise.resolve();
  }

  setTtsStart(conversationId: string, turnId: string, ms: number, flags: string[]): Promise<void> {
    this.ttsStarts.push({ conversationId, turnId, ms, flags });
    const row = this.turns.find((t) => t.id === turnId && t.conversationId === conversationId);
    if (row && row.ttsStartMs === null) {
      row.ttsStartMs = ms;
      row.flags = [...row.flags, ...flags];
    }
    return Promise.resolve();
  }

  end(id: string, e: ConversationEnd): Promise<void> {
    this.ended.push({ id, ...e });
    return Promise.resolve();
  }

  saveFeedback(f: Feedback): Promise<"saved" | "duplicate" | "no_conversation"> {
    if (!this.started.some((s) => s.id === f.conversationId)) {
      return Promise.resolve("no_conversation");
    }
    if (this.feedback.some((x) => x.conversationId === f.conversationId)) {
      return Promise.resolve("duplicate");
    }
    this.feedback.push(f);
    return Promise.resolve("saved");
  }
}
