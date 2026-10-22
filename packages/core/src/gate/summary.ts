import type { Slot } from "../availability/types.js";
import { formatWhen } from "../agent/tools/format.js";
import type { PendingAction } from "../agent/types.js";
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
      return `To confirm: a table for ${args.partySize} on ${when(config, action.slot!.start)} under ${args.name}.${notes} Shall I book it?`;
    }
    case "reschedule":
      return `To confirm: move your reservation for ${action.reservation!.partySize} from ${when(config, action.reservation!.start)} to ${when(config, action.slot!.start)}. Shall I make the change?`;
    case "cancel":
      return `To confirm: cancel your reservation for ${action.reservation!.partySize} on ${when(config, action.reservation!.start)}. Shall I cancel it?`;
  }
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
export const RESERVATION_GONE_REPLY =
  "I can't find that reservation anymore, so nothing was changed.";

export function lateChangeReply(config: BusinessConfig): string {
  return `That reservation is now within ${config.policies.freeChangeUntilHoursBefore} hours, so I can't change it here, and nothing was changed.`;
}
