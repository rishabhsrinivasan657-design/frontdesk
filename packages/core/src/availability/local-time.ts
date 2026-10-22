import { DateTime } from "luxon";
import { type BusinessConfig, DAY_KEYS, minutesOfDay } from "../config/schema.js";

/**
 * Start times on the slot grid within opening hours, up to the last-seating cutoff, as
 * business-local DateTimes in chronological order. Wall times that don't exist (spring
 * forward) are skipped; ambiguous ones (fall back) appear once, at the earlier offset.
 */
export function localWallTimesOnGrid(config: BusinessConfig, date: string): DateTime[] {
  const zone = config.business.timezone;
  const day = DateTime.fromISO(date, { zone });
  const { slotIntervalMinutes: grid, lastSeatingBeforeCloseMinutes } = config.seating;
  const intervals = config.hours[DAY_KEYS[day.weekday % 7]!];

  const byMinute = new Map<number, DateTime>();
  for (const { open, close } of intervals) {
    const last = minutesOfDay(close) - lastSeatingBeforeCloseMinutes;
    for (let m = Math.ceil(minutesOfDay(open) / grid) * grid; m <= last; m += grid) {
      const wall = day.set({ hour: Math.floor(m / 60), minute: m % 60 });
      if (wall.hour * 60 + wall.minute !== m) continue; // nonexistent: Luxon shifted it forward
      byMinute.set(m, wall);
    }
  }
  return [...byMinute.entries()].sort(([a], [b]) => a - b).map(([, wall]) => wall);
}

/** The business-local calendar date of an instant, "YYYY-MM-DD". */
export function localToday(now: Date, zone: string): string {
  return DateTime.fromJSDate(now, { zone }).toISODate()!;
}
