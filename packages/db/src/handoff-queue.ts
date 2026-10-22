import type { HandoffQueue, HandoffReason, HandoffTicket, TranscriptEntry } from "@frontdesk/core";
import { asc, isNull } from "drizzle-orm";
import type { Db } from "./client.js";
import { handoffs } from "./schema.js";
import { iso } from "./time.js";

/** The human review queue in Postgres (spec §3). */
export class PgHandoffQueue implements HandoffQueue {
  constructor(private readonly db: Db) {}

  async enqueue(ticket: HandoffTicket): Promise<void> {
    await this.db.insert(handoffs).values({
      id: ticket.id,
      sessionId: ticket.sessionId,
      reason: ticket.reason,
      summary: ticket.summary,
      transcript: ticket.transcript,
      createdAt: ticket.createdAt,
    });
  }

  /** Unresolved tickets, oldest first. */
  async open(): Promise<HandoffTicket[]> {
    const rows = await this.db
      .select()
      .from(handoffs)
      .where(isNull(handoffs.resolvedAt))
      .orderBy(asc(handoffs.createdAt));
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      reason: r.reason as HandoffReason,
      summary: r.summary,
      transcript: r.transcript as TranscriptEntry[],
      createdAt: iso(r.createdAt),
    }));
  }
}
