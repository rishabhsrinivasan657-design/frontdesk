import { DateTime } from "luxon";
import { type BusinessConfig, DAY_KEYS } from "../config/schema.js";
import type { Booking } from "../ports/calendar.js";
import { tablesFromConfig } from "./tables.js";

/** One reservation placed on the owner's day: local minutes for layout, labels for reading. */
export interface DayReservation {
  id: string;
  tableId: string;
  partySize: number;
  name: string;
  contact: string;
  start: string;
  end: string;
  /** Minutes since local midnight (the business timezone). */
  startMinute: number;
  endMinute: number;
  startLabel: string;
  endLabel: string;
}

export interface DayView {
  /** "YYYY-MM-DD", business-local. */
  date: string;
  /** "Saturday, November 7". */
  label: string;
  open: boolean;
  /** Opening intervals that day, "HH:mm" (empty when closed). */
  hours: { open: string; close: string }[];
  tables: { id: string; size: number }[];
  seats: number;
  reservations: DayReservation[];
}

export interface WeekDay {
  date: string;
  /** "Sat 7". */
  label: string;
  open: boolean;
  bookings: number;
  guests: number;
}

const day = (config: BusinessConfig, date: string) =>
  DateTime.fromISO(date, { zone: config.business.timezone });

function isOpen(config: BusinessConfig, date: string): boolean {
  if (config.closures.some((c) => c.date === date)) return false;
  return (config.hours[DAY_KEYS[day(config, date).weekday % 7]!] ?? []).length > 0;
}

/** The instants a local day spans: local midnight to the next local midnight (DST-safe). */
export function dayRange(config: BusinessConfig, date: string): { from: Date; to: Date } {
  const start = day(config, date).startOf("day");
  return { from: start.toJSDate(), to: start.plus({ days: 1 }).toJSDate() };
}

const localDateOf = (config: BusinessConfig, at: Date) =>
  DateTime.fromJSDate(at, { zone: config.business.timezone }).toISODate()!;

/** The owner's calendar for `date`: every table, and the reservations that start that day. */
export function dayView(config: BusinessConfig, date: string, reservations: Booking[]): DayView {
  const zone = config.business.timezone;
  const open = isOpen(config, date);
  const tables = tablesFromConfig(config).map(({ id, size }) => ({ id, size }));
  const minute = (dt: DateTime) => dt.hour * 60 + dt.minute;
  return {
    date,
    label: day(config, date).toFormat("cccc, LLLL d"),
    open,
    hours: open ? [...(config.hours[DAY_KEYS[day(config, date).weekday % 7]!] ?? [])] : [],
    tables,
    seats: tables.reduce((n, t) => n + t.size, 0),
    reservations: reservations
      .filter((r) => localDateOf(config, r.start) === date)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((r) => {
        const s = DateTime.fromJSDate(r.start, { zone });
        const e = DateTime.fromJSDate(r.end, { zone });
        return {
          id: r.id,
          tableId: r.tableId,
          partySize: r.partySize,
          name: r.name,
          contact: r.contact,
          start: r.start.toISOString(),
          end: r.end.toISOString(),
          startMinute: minute(s),
          // A booking that runs past midnight is drawn to the end of the day.
          endMinute: localDateOf(config, r.end) === date ? minute(e) : 24 * 60,
          startLabel: s.toFormat("h:mm a"),
          endLabel: e.toFormat("h:mm a"),
        };
      }),
  };
}

/** `days` local days from `today`, with how many bookings and guests each has. */
export function weekStrip(
  config: BusinessConfig,
  today: string,
  reservations: Booking[],
  days = 7,
): WeekDay[] {
  return Array.from({ length: days }, (_, i) => {
    const d = day(config, today).plus({ days: i });
    const date = d.toISODate()!;
    const mine = reservations.filter((r) => localDateOf(config, r.start) === date);
    return {
      date,
      label: d.toFormat("ccc d"),
      open: isOpen(config, date),
      bookings: mine.length,
      guests: mine.reduce((n, r) => n + r.partySize, 0),
    };
  });
}
