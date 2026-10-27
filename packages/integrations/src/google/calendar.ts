import {
  type Booking,
  type Calendar,
  CalendarUnavailableError,
  type MoveTo,
  type NewBooking,
  normalizeContact,
} from "@frontdesk/core";
import { type calendar_v3, calendar as calendarClient } from "@googleapis/calendar";
import { createOAuthClient, GOOGLE_API_OPTIONS } from "./client.js";
import type { GoogleEnv } from "./env.js";
import { googleFailure, isUnavailable } from "./errors.js";
import { FRONTDESK_MARK, fromEvent, RUN_TAG, toEvent } from "./event-mapping.js";

type Response<T> = Promise<{ data: T }>;

/** The slice of googleapis' `calendar.events` this adapter uses (a fake in unit tests). */
export interface EventsApi {
  list(p: calendar_v3.Params$Resource$Events$List): Response<calendar_v3.Schema$Events>;
  get(p: calendar_v3.Params$Resource$Events$Get): Response<calendar_v3.Schema$Event>;
  insert(p: calendar_v3.Params$Resource$Events$Insert): Response<calendar_v3.Schema$Event>;
  patch(p: calendar_v3.Params$Resource$Events$Patch): Response<calendar_v3.Schema$Event>;
  delete(p: calendar_v3.Params$Resource$Events$Delete): Promise<unknown>;
}

const statusOf = (e: unknown) =>
  (e as { response?: { status?: number } } | undefined)?.response?.status;
const isGone = (e: unknown) => statusOf(e) === 404 || statusOf(e) === 410;

/** Google Calendar adapter: the only source of truth for reservations (spec §3). */
export class GoogleCalendar implements Calendar {
  private readonly events: EventsApi;
  private readonly calendarId: string;
  private readonly tag: string | undefined;

  constructor(opts: { events: EventsApi; calendarId: string; tag?: string }) {
    this.events = opts.events;
    this.calendarId = opts.calendarId;
    this.tag = opts.tag;
  }

  async listReservations(range: { from: Date; to: Date }): Promise<Booking[]> {
    // timeMin/timeMax select events overlapping [from, to): end > from and start < to.
    const bookings = await this.listAll(
      { timeMin: range.from.toISOString(), timeMax: range.to.toISOString() },
      [],
    );
    return bookings.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  async getReservation(id: string): Promise<Booking | undefined> {
    try {
      const { data } = await this.call("events.get", () =>
        this.events.get({ calendarId: this.calendarId, eventId: id }),
      );
      return fromEvent(data, this.tag);
    } catch (error) {
      if (error instanceof GoneError) return undefined;
      throw error;
    }
  }

  async findReservations(query: { name: string; contact: string }): Promise<Booking[]> {
    const contactKey = normalizeContact(query.contact);
    if (contactKey === "") return [];
    const name = query.name.trim().toLowerCase();
    const matches = await this.listAll({}, [`contactKey=${contactKey}`]);
    return matches.filter((b) => b.name.trim().toLowerCase() === name);
  }

  async createReservation(input: NewBooking): Promise<Booking> {
    const { data } = await this.call("events.insert", () =>
      this.events.insert({ calendarId: this.calendarId, requestBody: toEvent(input, this.tag) }),
    );
    return this.booking(data, "events.insert");
  }

  async moveReservation(id: string, to: MoveTo): Promise<Booking> {
    const existing = await this.getReservation(id);
    if (!existing) throw new Error(`No reservation ${id}`);
    const { partySize = existing.partySize, ...placement } = to;
    const { data } = await this.call("events.patch", () =>
      this.events.patch({
        calendarId: this.calendarId,
        eventId: id,
        requestBody: toEvent({ ...existing, ...placement, partySize }, this.tag),
      }),
    );
    return this.booking(data, "events.patch");
  }

  async cancelReservation(id: string): Promise<void> {
    try {
      await this.call("events.delete", () =>
        this.events.delete({ calendarId: this.calendarId, eventId: id }),
      );
    } catch (error) {
      if (error instanceof GoneError) throw new Error(`No reservation ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Pilot retention (M10): bookings that ended before `before` (looking back 60 days) keep their
   * time, table and party but lose the guest's name, contact and notes. Returns how many changed.
   */
  async redactReservationsBefore(before: Date): Promise<number> {
    const from = new Date(before.getTime() - 60 * 86_400_000);
    const ended = (await this.listReservations({ from, to: before })).filter(
      (b) => b.end.getTime() <= before.getTime() && !(b.name === "Guest" && b.contact === ""),
    );
    for (const b of ended) {
      await this.call("events.patch", () =>
        this.events.patch({
          calendarId: this.calendarId,
          eventId: b.id,
          requestBody: toEvent({ ...b, name: "Guest", contact: "", notes: "" }, this.tag),
        }),
      );
    }
    return ended.length;
  }

  private async listAll(
    window: { timeMin?: string; timeMax?: string },
    filters: string[],
  ): Promise<Booking[]> {
    const privateExtendedProperty = [
      `${FRONTDESK_MARK}=1`,
      ...(this.tag ? [`${RUN_TAG}=${this.tag}`] : []),
      ...filters,
    ];
    const bookings: Booking[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await this.call("events.list", () =>
        this.events.list({
          calendarId: this.calendarId,
          ...window,
          singleEvents: true,
          showDeleted: false,
          maxResults: 2500,
          privateExtendedProperty,
          ...(pageToken ? { pageToken } : {}),
        }),
      );
      for (const e of data.items ?? []) {
        const b = fromEvent(e, this.tag);
        if (b) bookings.push(b);
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    return bookings;
  }

  private booking(data: calendar_v3.Schema$Event, what: string): Booking {
    const b = fromEvent(data, this.tag);
    if (!b) throw new Error(`Calendar ${what} returned an event that is not a booking`);
    return b;
  }

  /** Runs one API call and translates its failure into a secret-free error. */
  private async call<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const failure = googleFailure(error, `Calendar ${what}`);
      if (isUnavailable(error)) throw new CalendarUnavailableError(failure.message);
      if (isGone(error)) throw new GoneError(failure.message);
      throw failure;
    }
  }
}

class GoneError extends Error {
  override name = "GoneError";
}

/** The real adapter for `env`'s demo calendar. `tag` isolates a test run's events. */
export function createGoogleCalendar(env: GoogleEnv, opts: { tag?: string } = {}): GoogleCalendar {
  const api = calendarClient({
    version: "v3",
    auth: createOAuthClient(env),
    ...GOOGLE_API_OPTIONS,
  });
  return new GoogleCalendar({ events: api.events, calendarId: env.calendarId, ...opts });
}
