import { findSlots } from "../availability/find-slots.js";
import type { Slot } from "../availability/types.js";
import { reservationsAround } from "../agent/tools/read-tools.js";
import type { BusinessConfig } from "../config/schema.js";
import type { CalendarReader } from "../ports/calendar.js";

/**
 * Re-runs the availability engine against fresh Calendar data (spec §5 race protection).
 * The slot is still good if the engine still offers its time and its own table is still free.
 * `excludeId` is the reservation being moved, so its current hold doesn't block itself.
 */
export async function recheckSlot(
  config: BusinessConfig,
  calendar: CalendarReader,
  slot: Slot,
  now: Date,
  excludeId?: string,
): Promise<{ free: boolean; alternatives: Slot[] }> {
  const reservations = (
    await reservationsAround(calendar, slot.date, config.business.timezone)
  ).filter((r) => r.id !== excludeId);
  const request = { date: slot.date, time: slot.time, partySize: slot.partySize };
  const offered = findSlots(config, reservations, request, now);
  const start = Date.parse(slot.start);
  const end = Date.parse(slot.end);
  const tableFree = !reservations.some(
    (r) => r.tableId === slot.tableId && r.start.getTime() < end && start < r.end.getTime(),
  );
  const free = tableFree && offered.some((s) => s.time === slot.time);
  return { free, alternatives: offered.filter((s) => s.id !== slot.id) };
}

/** True when the reservation starts inside the free-change window (spec §2: 4 hours). */
export function insideChangeWindow(config: BusinessConfig, start: Date, now: Date): boolean {
  const windowMs = config.policies.freeChangeUntilHoursBefore * 3600_000;
  return start.getTime() - now.getTime() < windowMs;
}
