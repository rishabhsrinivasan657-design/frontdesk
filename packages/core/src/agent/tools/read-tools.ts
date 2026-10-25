import { DateTime } from "luxon";
import { findSlots } from "../../availability/find-slots.js";
import { agentPartyLimit } from "../../availability/tables.js";
import type { BusinessConfig } from "../../config/schema.js";
import { type CalendarReader, CalendarUnavailableError } from "../../ports/calendar.js";
import type { Clock } from "../../ports/clock.js";
import type { HandoffReason, SessionState } from "../types.js";
import { formatWhen, pickSpread } from "./format.js";
import { TOOL_ARGS } from "./schemas.js";

export type ToolResult =
  { ok: true; data: unknown } | { ok: false; error: string; message: string };

export interface ReadToolContext {
  config: BusinessConfig;
  calendar: CalendarReader;
  clock: Clock;
  session: SessionState;
}

/** Thrown (not returned) so the loop stops and hands off. */
export class HandoffSignal extends Error {
  override name = "HandoffSignal";

  constructor(
    readonly reason: HandoffReason,
    readonly summary?: string,
  ) {
    super(`Handoff: ${reason}`);
  }
}

const MAX_DAY_SLOTS = 8;

export const fail = (error: string, message: string): ToolResult => ({
  ok: false,
  error,
  message,
});

/** The reservations that can affect slots on a business-local date. */
export function reservationsAround(
  calendar: CalendarReader,
  date: string,
  zone: string,
): ReturnType<CalendarReader["listReservations"]> {
  const day = DateTime.fromISO(date, { zone });
  return calendar.listReservations({
    from: day.minus({ days: 1 }).toJSDate(),
    to: day.plus({ days: 2 }).toJSDate(),
  });
}

async function checkAvailability(
  args: { date: string; time?: string; partySize: number },
  ctx: ReadToolContext,
): Promise<ToolResult> {
  const { config, session } = ctx;
  if (args.partySize > agentPartyLimit(config)) throw new HandoffSignal("party_too_large");
  const zone = config.business.timezone;
  const reservations = await reservationsAround(ctx.calendar, args.date, zone);
  let slots;
  try {
    slots = findSlots(config, reservations, args, ctx.clock.now());
  } catch (error) {
    if (error instanceof RangeError) return fail("invalid_request", error.message);
    throw error;
  }
  if (args.time === undefined) slots = pickSpread(slots, MAX_DAY_SLOTS);
  for (const slot of slots) session.offeredSlots[slot.id] = slot;
  return {
    ok: true,
    data: {
      date: args.date,
      partySize: args.partySize,
      available: args.time === undefined ? slots.length > 0 : slots[0]?.time === args.time,
      slots: slots.map((s) => ({ slotId: s.id, time: s.time, when: formatWhen(s.start, zone) })),
    },
  };
}

async function findReservation(
  args: { name: string; contact: string },
  ctx: ReadToolContext,
): Promise<ToolResult> {
  const now = ctx.clock.now();
  const found = (await ctx.calendar.findReservations(args)).filter((b) => b.start > now);
  for (const b of found) ctx.session.knownReservations[b.id] = b;
  const zone = ctx.config.business.timezone;
  return {
    ok: true,
    data: {
      reservations: found.map((b) => ({
        reservationId: b.id,
        when: formatWhen(b.start, zone),
        partySize: b.partySize,
        name: b.name,
      })),
    },
  };
}

function lookupFaq(args: { query: string }, ctx: ReadToolContext): ToolResult {
  const query = args.query.toLowerCase();
  const answers = ctx.config.faq
    .filter(
      (f) =>
        f.keywords.some((k) => query.includes(k.toLowerCase())) ||
        f.q.toLowerCase().includes(query),
    )
    .slice(0, 3)
    .map((f) => ({ id: f.id, a: f.a }));
  return { ok: true, data: { answers } };
}

function getMenuItem(args: { name: string }, ctx: ReadToolContext): ToolResult {
  const needle = args.name.toLowerCase();
  const item = ctx.config.menu.find((m) => m.item.toLowerCase().includes(needle));
  return {
    ok: true,
    data: item
      ? { found: true, item: item.item, price: item.price, tags: item.tags }
      : { found: false },
  };
}

/**
 * Runs a read tool or request_handoff. Write tools are not dispatchable here: they go
 * through the gate's `propose` and come back as unknown_tool if they reach this function.
 */
export async function runReadTool(
  name: string,
  rawArgs: unknown,
  ctx: ReadToolContext,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "check_availability": {
        const args = TOOL_ARGS.check_availability.safeParse(rawArgs);
        if (!args.success) return fail("invalid_args", args.error.message);
        return await checkAvailability(args.data, ctx);
      }
      case "find_reservation": {
        const args = TOOL_ARGS.find_reservation.safeParse(rawArgs);
        if (!args.success) return fail("invalid_args", args.error.message);
        return await findReservation(args.data, ctx);
      }
      case "lookup_faq": {
        const args = TOOL_ARGS.lookup_faq.safeParse(rawArgs);
        if (!args.success) return fail("invalid_args", args.error.message);
        return lookupFaq(args.data, ctx);
      }
      case "get_menu_item": {
        const args = TOOL_ARGS.get_menu_item.safeParse(rawArgs);
        if (!args.success) return fail("invalid_args", args.error.message);
        return getMenuItem(args.data, ctx);
      }
      case "request_handoff": {
        const args = TOOL_ARGS.request_handoff.safeParse(rawArgs);
        if (!args.success) return fail("invalid_args", args.error.message);
        throw new HandoffSignal(args.data.reason, args.data.summary);
      }
      default:
        return fail("unknown_tool", `No read tool named ${JSON.stringify(name)}`);
    }
  } catch (error) {
    if (error instanceof CalendarUnavailableError) throw new HandoffSignal("calendar_unavailable");
    throw error;
  }
}
