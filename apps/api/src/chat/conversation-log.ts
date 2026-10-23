import type { HandoffReason } from "@frontdesk/core";
import type { TurnRecord } from "@frontdesk/db";

export interface ConversationStart {
  id: string;
  source: "live";
  startedAt: string;
}

export interface ConversationEnd {
  endedAt: string;
  outcome: string;
  handoffReason?: HandoffReason;
}

/** Where conversations and their turns are stored (spec §3). `PgConversations` satisfies it. */
export interface ConversationLog {
  start(c: ConversationStart): Promise<void>;
  recordTurn(t: TurnRecord): Promise<void>;
  end(id: string, e: ConversationEnd): Promise<void>;
}

export class InMemoryConversationLog implements ConversationLog {
  readonly started: ConversationStart[] = [];
  readonly turns: TurnRecord[] = [];
  readonly ended: (ConversationEnd & { id: string })[] = [];

  start(c: ConversationStart): Promise<void> {
    this.started.push(c);
    return Promise.resolve();
  }

  recordTurn(t: TurnRecord): Promise<void> {
    this.turns.push(t);
    return Promise.resolve();
  }

  end(id: string, e: ConversationEnd): Promise<void> {
    this.ended.push({ id, ...e });
    return Promise.resolve();
  }
}
