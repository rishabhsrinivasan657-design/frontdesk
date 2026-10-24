import type { ActionKind } from "@frontdesk/core";
import { sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { type OwnerSource, isoOf, rows, sourceIs } from "./shared.js";

export type BookingStatus = "booked" | "rescheduled" | "cancelled";

/** A reservation the agent wrote, as of its latest executed action (Calendar owns the event). */
export interface BookingRow {
  actionId: string;
  sessionId: string;
  seeded: boolean;
  kind: ActionKind;
  status: BookingStatus;
  reservationId: string;
  name: string;
  contact: string;
  partySize: number;
  start: string;
  end: string;
  executedAt: string;
  /** The confirmation email: sent, failed every attempt so far, or not attempted. */
  emailed: boolean | null;
}

const STATUS: Record<ActionKind, BookingStatus> = {
  book: "booked",
  reschedule: "rescheduled",
  cancel: "cancelled",
};

/** Newest action first. `result` of an `executed` row is core's `Booking`. */
export async function listBookings(
  db: Db,
  o: { source: OwnerSource; limit?: number },
): Promise<BookingRow[]> {
  const found = await rows<{
    action_id: string;
    session_id: string;
    seeded: boolean;
    kind: ActionKind;
    result: {
      id: string;
      name: string;
      contact: string;
      partySize: number;
      start: string;
      end: string;
    };
    at: Date;
    email_sent: boolean;
    email_failed: boolean;
  }>(
    db,
    sql`select * from (
      select distinct on (a.result->>'id') a.action_id, a.session_id, c.seeded, a.kind,
        a.result, a.at,
        exists (select 1 from audit_log e where e.action_id = a.action_id
          and e.stage = 'email_sent') as email_sent,
        exists (select 1 from audit_log e where e.action_id = a.action_id
          and e.stage = 'email_failed') as email_failed
      from audit_log a join conversations c on c.id = a.session_id
      where a.stage = 'executed' and a.result ? 'id' and ${sourceIs(o.source)}
      order by a.result->>'id', a.seq desc
    ) latest
    order by latest.at desc
    limit ${o.limit ?? 200}`,
  );
  return found.map((r) => ({
    actionId: r.action_id,
    sessionId: r.session_id,
    seeded: r.seeded,
    kind: r.kind,
    status: STATUS[r.kind],
    reservationId: r.result.id,
    name: r.result.name,
    contact: r.result.contact,
    partySize: r.result.partySize,
    start: isoOf(r.result.start),
    end: isoOf(r.result.end),
    executedAt: isoOf(r.at),
    emailed: r.email_sent ? true : r.email_failed ? false : null,
  }));
}
