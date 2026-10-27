import type { HandoffQueue, HandoffReason, HandoffTicket, TranscriptEntry } from "@frontdesk/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "./client.js";
import { type HandoffOutcome, handoffs } from "./schema.js";
import { iso } from "./time.js";

/** The human review queue in Postgres (spec §3). */
export class PgHandoffQueue implements HandoffQueue {
  constructor(private readonly db: Db) {}

  async enqueue(ticket: HandoffTicket): Promise<void> {
    await this.db
      .insert(handoffs)
      .values({
        id: ticket.id,
        sessionId: ticket.sessionId,
        reason: ticket.reason,
        summary: ticket.summary,
        transcript: ticket.transcript,
        createdAt: ticket.createdAt,
      })
      // Ticket ids are deterministic for retried producers (e.g. the email worker).
      .onConflictDoNothing({ target: handoffs.id });
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

  /**
   * Resolves an open ticket with the owner's notes and what came of it (spec §12). A resolved
   * ticket keeps its first notes and outcome.
   */
  async resolve(
    id: string,
    notes: string,
    at: string,
    outcome: HandoffOutcome,
  ): Promise<"resolved" | "not_found" | "already_resolved"> {
    const updated = await this.db
      .update(handoffs)
      .set({ resolvedAt: at, notes, outcome })
      .where(and(eq(handoffs.id, id), isNull(handoffs.resolvedAt)))
      .returning({ id: handoffs.id });
    if (updated.length > 0) return "resolved";
    const [existing] = await this.db
      .select({ id: handoffs.id })
      .from(handoffs)
      .where(eq(handoffs.id, id));
    return existing ? "already_resolved" : "not_found";
  }
}
