import type { Reservation } from "../availability/types.js";

/** A reservation as Calendar stores it (spec §5: details live in the event's private properties). */
export interface Booking extends Reservation {
  name: string;
  contact: string;
  notes: string;
}

export type NewBooking = Omit<Booking, "id">;

/** Calendar could not be reached; the agent must not write and hands off (spec §11). */
export class CalendarUnavailableError extends Error {
  override name = "CalendarUnavailableError";
}

/** The read half of Calendar. Tools only ever receive this. */
export interface CalendarReader {
  /** Bookings overlapping [from, to). */
  listReservations(range: { from: Date; to: Date }): Promise<Booking[]>;
  getReservation(id: string): Promise<Booking | undefined>;
  /** Bookings whose name matches case-insensitively and whose contact matches after `normalizeContact`. */
  findReservations(query: { name: string; contact: string }): Promise<Booking[]>;
}

/** Google Calendar is the only source of truth for reservations (spec §3). */
export interface Calendar extends CalendarReader {
  createReservation(input: NewBooking): Promise<Booking>;
  moveReservation(id: string, to: { start: Date; end: Date; tableId: string }): Promise<Booking>;
  cancelReservation(id: string): Promise<void>;
}

/** Email → trimmed lowercase; anything else → its digits only. */
export function normalizeContact(contact: string): string {
  const trimmed = contact.trim();
  return trimmed.includes("@") ? trimmed.toLowerCase() : trimmed.replace(/\D/g, "");
}
