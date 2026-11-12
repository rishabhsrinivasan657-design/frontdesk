import { DateTime } from "luxon";
import type { Slot } from "../availability/types.js";
import { localWallTimesOnGrid } from "../availability/local-time.js";
import { formatWhen } from "../agent/tools/format.js";
import type { CardDetails, PendingAction } from "../agent/types.js";
import type { BusinessConfig } from "../config/schema.js";
import type { Booking } from "../ports/calendar.js";

/** Deterministic gate text (plan ruling 4): built from data, never from the LLM. */

const when = (config: BusinessConfig, at: string | Date) =>
  formatWhen(at, config.business.timezone);

export function readBack(action: PendingAction, config: BusinessConfig): string {
  const { args } = action;
  switch (args.kind) {
    case "book": {
      const notes = args.notes.trim() ? ` Notes: ${args.notes.trim()}.` : "";
      return `To confirm: a table for ${args.partySize} on ${when(config, action.slot!.start)} under ${args.name}, contact ${args.contact}.${notes} Shall I book it?`;
    }
    case "reschedule": {
      const from = action.reservation!;
      const to = action.slot!;
      const fromWhen = when(config, from.start);
      const toWhen = when(config, to.start);
      if (to.partySize === from.partySize) {
        return `To confirm: move your reservation for ${from.partySize} from ${fromWhen} to ${toWhen}. Shall I make the change?`;
      }
      if (fromWhen === toWhen) {
        return `To confirm: change your reservation on ${fromWhen} from a party of ${from.partySize} to a party of ${to.partySize}. Shall I make the change?`;
      }
      return `To confirm: change your reservation for ${from.partySize} on ${fromWhen} to a party of ${to.partySize} on ${toWhen}. Shall I make the change?`;
    }
    case "cancel":
      return `To confirm: cancel your reservation for ${action.reservation!.partySize} on ${when(config, action.reservation!.start)}. Shall I cancel it?`;
  }
}

const WINDOW = 5;
const TIME = "h:mm a";

/** The read-back's slot as display data (plan ruling 4 applies: from data, never the LLM). */
export function cardDetails(action: PendingAction, config: BusinessConfig): CardDetails {
  const zone = config.business.timezone;
  const local = (at: string | Date) =>
    (typeof at === "string" ? DateTime.fromISO(at) : DateTime.fromJSDate(at)).setZone(zone);
  const { args } = action;
  // A book or reschedule shows the new slot; a cancel shows the booking it removes.
  const target = args.kind === "cancel" ? action.reservation! : action.slot!;
  const start = local(target.start);
  const name = args.kind === "book" ? args.name : action.reservation!.name;
  const partySize = args.kind === "book" ? args.partySize : target.partySize;
  const details: CardDetails = {
    date: start.toFormat("cccc, LLLL d"),
    time: start.toFormat(TIME),
    partySize,
    name,
    times: nearbyTimes(config, start),
  };
  if (args.kind === "reschedule") {
    const from = local(action.reservation!.start);
    details.from = {
      date: from.toFormat("cccc, LLLL d"),
      time: from.toFormat(TIME),
      partySize: action.reservation!.partySize,
    };
  }
  return details;
}

/** Seating times on the grid that day, a window around `start` (just `start` if off-grid). */
function nearbyTimes(config: BusinessConfig, start: DateTime): string[] {
  const grid = localWallTimesOnGrid(config, start.toISODate()!);
  const at = grid.findIndex((t) => t.hour === start.hour && t.minute === start.minute);
  if (at < 0) return [start.toFormat(TIME)];
  const from = Math.max(0, Math.min(at - Math.floor(WINDOW / 2), grid.length - WINDOW));
  return grid.slice(from, from + WINDOW).map((t) => t.toFormat(TIME));
}

export function executedReply(
  action: PendingAction,
  booking: Booking,
  config: BusinessConfig,
  emailed: boolean,
): string {
  const email = emailed ? " A confirmation email is on its way." : "";
  switch (action.args.kind) {
    case "book":
      return `You're all set: a table for ${booking.partySize} on ${when(config, booking.start)} under ${booking.name}.${email}`;
    case "reschedule":
      return `Done. Your reservation for ${booking.partySize} is now on ${when(config, booking.start)}.${email}`;
    case "cancel":
      return `Done. Your reservation for ${booking.partySize} on ${when(config, booking.start)} is cancelled.${email}`;
  }
}

export function slotGoneReply(
  action: PendingAction,
  alternatives: Slot[],
  config: BusinessConfig,
): string {
  const nothing = action.args.kind === "book" ? "nothing was booked" : "nothing was changed";
  if (alternatives.length === 0) {
    return `Sorry, that time was just taken, so ${nothing}, and nothing nearby is open that day. Would another day work?`;
  }
  const times = alternatives.map((s) => when(config, s.start));
  const list =
    times.length === 1 ? times[0]! : `${times.slice(0, -1).join(", ")} or ${times.at(-1)!}`;
  return `Sorry, that time was just taken, so ${nothing}. I can offer ${list}. Would one of those work?`;
}

export const EXPIRED_REPLY =
  "That request timed out after 5 minutes, so I didn't make any change. Would you like me to check again?";
export const NOTHING_PENDING_REPLY = "There's nothing waiting for confirmation right now.";
export const CALENDAR_DOWN_REPLY =
  "Sorry, I couldn't reach our booking system, so nothing was changed.";
export const AUDIT_FAILED_REPLY =
  "Sorry, something went wrong on my side, so nothing was changed. Could we try that again?";
export const RESERVATION_CHANGED_REPLY =
  "That reservation changed since I read it back, so I didn't change anything. Shall I look it up again?";
export const RESERVATION_GONE_REPLY =
  "I can't find that reservation anymore, so nothing was changed.";

export function lateChangeReply(config: BusinessConfig): string {
  return `That reservation is now within ${config.policies.freeChangeUntilHoursBefore} hours, so I can't change it here, and nothing was changed.`;
}
