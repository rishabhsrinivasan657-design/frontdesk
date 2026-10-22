import { DateTime } from "luxon";
import { type BusinessConfig, DATE_PATTERN, TIME_PATTERN, minutesOfDay } from "../config/schema.js";
import { localToday, localWallTimesOnGrid } from "./local-time.js";
import { type Table, UnknownTableError, holdMinutesFor, tablesFromConfig } from "./tables.js";
import type { Reservation, Slot, SlotRequest } from "./types.js";

const MAX_ALTERNATIVES = 3;

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
  if (Number.isNaN(now.getTime())) throw new RangeError("now must be a valid Date");
  const tables = tablesFromConfig(config);
  const known = new Set(tables.map((t) => t.id));
  for (const r of reservations) {
    if (!known.has(r.tableId)) throw new UnknownTableError(r.id, r.tableId);
    if (!(r.start.getTime() < r.end.getTime())) {
      // Also catches invalid Dates (NaN): a reservation we can't place must not read as free.
      throw new RangeError(`Reservation ${r.id} needs a valid start before its end`);
    }
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
  return request.time === undefined ? slots : exactOrAlternatives(slots, request.time);
}

/**
 * The slot at `time` if it's available; otherwise up to three alternatives: the nearest
 * earlier and nearest later slot, then the next nearest overall (ties go earlier).
 */
function exactOrAlternatives(slots: Slot[], time: string): Slot[] {
  const exact = slots.find((s) => s.time === time);
  if (exact) return [exact];

  const target = minutesOfDay(time);
  const distance = (s: Slot) => Math.abs(minutesOfDay(s.time) - target);
  const earlier = slots.filter((s) => minutesOfDay(s.time) < target).at(-1);
  const later = slots.find((s) => minutesOfDay(s.time) > target);
  const picked = new Set([earlier, later].filter((s) => s !== undefined));
  const rest = slots.filter((s) => !picked.has(s)).sort((a, b) => distance(a) - distance(b));
  for (const s of rest) {
    if (picked.size >= MAX_ALTERNATIVES) break;
    picked.add(s);
  }
  return slots.filter((s) => picked.has(s));
}
