import { DateTime } from "luxon";
import { type BusinessConfig, DATE_PATTERN, TIME_PATTERN } from "../config/schema.js";
import { localToday, localWallTimesOnGrid } from "./local-time.js";
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
  _reservations: readonly Reservation[],
  request: SlotRequest,
  now: Date,
): Slot[] {
  validateRequest(request);
  const { date, partySize } = request;
  const zone = config.business.timezone;
  const { policies } = config;

  if (config.closures.some((c) => c.date === date)) return [];
  const lastBookableDate = DateTime.fromISO(localToday(now, zone))
    .plus({ days: policies.bookingWindowDays })
    .toISODate()!;
  if (date > lastBookableDate) return [];

  const tableSize = config.seating.tables
    .map((t) => t.size)
    .filter((size) => size >= partySize)
    .sort((a, b) => a - b)[0];
  if (tableSize === undefined) return [];
  const tableId = `t${tableSize}-1`;

  const earliest = now.getTime() + policies.minLeadMinutes * 60_000;
  const hold =
    partySize >= 5 ? config.seating.holdMinutes.partyOf5Plus : config.seating.holdMinutes.default;

  return localWallTimesOnGrid(config, date)
    .filter((start) => start.toMillis() >= earliest)
    .map((start) => {
      const time = start.toFormat("HH:mm");
      return {
        id: `${date}T${time}@${tableId}#${partySize}`,
        date,
        time,
        start: start.toISO({ suppressMilliseconds: true })!,
        end: start.plus({ minutes: hold }).toISO({ suppressMilliseconds: true })!,
        tableId,
        tableSize,
        partySize,
      };
    });
}
