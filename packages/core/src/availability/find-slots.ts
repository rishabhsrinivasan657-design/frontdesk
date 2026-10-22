import { DateTime } from "luxon";
import { type BusinessConfig, DATE_PATTERN, TIME_PATTERN } from "../config/schema.js";
import { localToday, localWallTimesOnGrid } from "./local-time.js";
import { type Table, UnknownTableError, holdMinutesFor, tablesFromConfig } from "./tables.js";
import type { Reservation, Slot, SlotRequest } from "./types.js";

function validateRequest(request: SlotRequest): void {
  const { date, time, partySize } = request;
  if (!DATE_PATTERN.test(date) || !DateTime.fromISO(date).isValid) {
    throw new RangeError(`date must be a real "YYYY-MM-DD" date, got ${JSON.stringify(date)}`);
  }
  if (time !== undefined && !TIME_PATTERN.test(time)) {
    throw new RangeError(`time must be "HH:mm", got ${JSON.stringify(time)}`);
  }
  if (!Number.isInteger(partySize) || partySize < 1) {
    throw new RangeError(`partySize must be a positive integer, got ${partySize}`);
  }
}

/** Available slots for a request (spec §5). Pure: all inputs are explicit. */
export function findSlots(
  config: BusinessConfig,
  reservations: readonly Reservation[],
  request: SlotRequest,
  now: Date,
): Slot[] {
  validateRequest(request);
  const tables = tablesFromConfig(config);
  const known = new Set(tables.map((t) => t.id));
  for (const r of reservations) {
    if (!known.has(r.tableId)) throw new UnknownTableError(r.id, r.tableId);
  }
  const { date, partySize } = request;
  const zone = config.business.timezone;
  const { policies } = config;

  if (config.closures.some((c) => c.date === date)) return [];
  const lastBookableDate = DateTime.fromISO(localToday(now, zone))
    .plus({ days: policies.bookingWindowDays })
    .toISODate()!;
  if (date > lastBookableDate) return [];

  const fitting = tables.filter((t) => t.size >= partySize);
  if (fitting.length === 0) return [];

  const earliest = now.getTime() + policies.minLeadMinutes * 60_000;
  const holdMs = holdMinutesFor(config, partySize) * 60_000;
  const isFree = (table: Table, start: number, end: number) =>
    !reservations.some(
      (r) => r.tableId === table.id && r.start.getTime() < end && start < r.end.getTime(),
    );

  const slots: Slot[] = [];
  for (const start of localWallTimesOnGrid(config, date)) {
    const startMs = start.toMillis();
    if (startMs < earliest) continue;
    // Smallest size first, lowest number first: tablesFromConfig is already in that order.
    const table = fitting.find((t) => isFree(t, startMs, startMs + holdMs));
    if (!table) continue;
    const time = start.toFormat("HH:mm");
    slots.push({
      id: `${date}T${time}@${table.id}#${partySize}`,
      date,
      time,
      start: start.toISO({ suppressMilliseconds: true })!,
      end: start.plus({ milliseconds: holdMs }).toISO({ suppressMilliseconds: true })!,
      tableId: table.id,
      tableSize: table.size,
      partySize,
    });
  }
  return slots;
}
