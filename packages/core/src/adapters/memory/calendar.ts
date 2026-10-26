import {
  type Booking,
  type Calendar,
  CalendarUnavailableError,
  type MoveTo,
  type NewBooking,
  normalizeContact,
} from "../../ports/calendar.js";
import type { IdGenerator } from "../../ports/ids.js";
import { deepCopy } from "./copy.js";
import { sequentialIds } from "./ids.js";

export type CalendarWrite = { op: "create" | "move" | "cancel"; id: string };

/** Calendar for tests and evals. `writes` logs every successful write, in order. */
export class InMemoryCalendar implements Calendar {
  readonly writes: CalendarWrite[] = [];
  private readonly bookings = new Map<string, Booking>();
  private unavailable = false;

  constructor(
    seed: Booking[] = [],
    private readonly ids: IdGenerator = sequentialIds(),
  ) {
    for (const b of seed) this.bookings.set(b.id, deepCopy(b));
  }

  /** While on, every method rejects with CalendarUnavailableError. */
  setUnavailable(on: boolean): void {
    this.unavailable = on;
  }

  listReservations(range: { from: Date; to: Date }): Promise<Booking[]> {
    return this.run(() =>
      [...this.bookings.values()]
        .filter((b) => b.start < range.to && range.from < b.end)
        .sort((a, b) => a.start.getTime() - b.start.getTime()),
    );
  }

  getReservation(id: string): Promise<Booking | undefined> {
    return this.run(() => this.bookings.get(id));
  }

  findReservations(query: { name: string; contact: string }): Promise<Booking[]> {
    const name = query.name.trim().toLowerCase();
    const contact = normalizeContact(query.contact);
    return this.run(() =>
      [...this.bookings.values()].filter(
        (b) =>
          b.name.trim().toLowerCase() === name &&
          contact !== "" &&
          normalizeContact(b.contact) === contact,
      ),
    );
  }

  createReservation(input: NewBooking): Promise<Booking> {
    return this.run(() => {
      const booking = { ...deepCopy(input), id: this.ids("res") };
      this.bookings.set(booking.id, booking);
      this.writes.push({ op: "create", id: booking.id });
      return booking;
    });
  }

  moveReservation(id: string, to: MoveTo): Promise<Booking> {
    return this.run(() => {
      const existing = this.bookings.get(id);
      if (!existing) throw new Error(`No reservation ${id}`);
      const { partySize = existing.partySize, ...placement } = to;
      const moved = { ...existing, ...deepCopy(placement), partySize };
      this.bookings.set(id, moved);
      this.writes.push({ op: "move", id });
      return moved;
    });
  }

  cancelReservation(id: string): Promise<void> {
    return this.run(() => {
      if (!this.bookings.delete(id)) throw new Error(`No reservation ${id}`);
      this.writes.push({ op: "cancel", id });
    });
  }

  // Synchronous body; async so a throw becomes a rejection, like a real adapter.
  // eslint-disable-next-line @typescript-eslint/require-await
  private async run<T>(fn: () => T): Promise<T> {
    if (this.unavailable) throw new CalendarUnavailableError("Calendar is unavailable");
    return deepCopy(fn());
  }
}
