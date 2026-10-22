import { DateTime } from "luxon";

/** "Friday, November 6 at 7:00 PM" in the business timezone. */
export function formatWhen(when: string | Date, zone: string): string {
  const dt =
    typeof when === "string"
      ? DateTime.fromISO(when, { zone })
      : DateTime.fromJSDate(when, { zone });
  return dt.setZone(zone).toFormat("cccc, LLLL d 'at' h:mm a");
}

/** Up to `max` items, evenly spaced, always keeping the first and last. */
export function pickSpread<T>(items: T[], max: number): T[] {
  if (items.length <= max) return [...items];
  if (max <= 1) return items.slice(0, max);
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)]!);
}
