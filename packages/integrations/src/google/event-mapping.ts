import { type Booking, type NewBooking, normalizeContact } from "@frontdesk/core";
import type { calendar_v3 } from "@googleapis/calendar";

/** Marks events Front Desk created, so other events on the calendar are never read as bookings. */
export const FRONTDESK_MARK = "frontdesk";
/** Tags events from one test run so the run only ever sees, and cleans up, its own. */
export const RUN_TAG = "frontdesk_run";

/**
 * A booking as a Calendar event. Details live in `extendedProperties.private` (spec §5).
 * No attendees: Google would send the guest its own invitation.
 */
export function toEvent(b: NewBooking, tag?: string): calendar_v3.Schema$Event {
  return {
    summary: `${b.name} (party of ${b.partySize})`,
    description: [`Table ${b.tableId}`, `Contact: ${b.contact}`, b.notes && `Notes: ${b.notes}`]
      .filter(Boolean)
      .join("\n"),
    start: { dateTime: b.start.toISOString() },
    end: { dateTime: b.end.toISOString() },
    extendedProperties: {
      private: {
        [FRONTDESK_MARK]: "1",
        partySize: String(b.partySize),
        tableId: b.tableId,
        name: b.name,
        contact: b.contact,
        contactKey: normalizeContact(b.contact),
        notes: b.notes,
        ...(tag ? { [RUN_TAG]: tag } : {}),
      },
    },
  };
}

/**
 * The booking an event holds, or undefined for cancelled or non-Front Desk events, and for
 * events whose run tag differs from `tag` (so a leaked test event never blocks a real slot).
 */
export function fromEvent(e: calendar_v3.Schema$Event, tag?: string): Booking | undefined {
  const p = e.extendedProperties?.private;
  if (e.status === "cancelled" || p?.[FRONTDESK_MARK] !== "1") return undefined;
  if ((p[RUN_TAG] ?? undefined) !== tag) return undefined;
  const start = e.start?.dateTime;
  const end = e.end?.dateTime;
  const partySize = Number(p.partySize);
  if (!e.id || !start || !end || !p.tableId || !Number.isInteger(partySize)) return undefined;
  return {
    id: e.id,
    start: new Date(start),
    end: new Date(end),
    tableId: p.tableId,
    partySize,
    name: p.name ?? "",
    contact: p.contact ?? "",
    notes: p.notes ?? "",
  };
}
