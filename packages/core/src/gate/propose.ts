import type { Slot } from "../availability/types.js";
import { agentPartyLimit } from "../availability/tables.js";
import { HandoffSignal, fail, type ToolResult } from "../agent/tools/read-tools.js";
import { TOOL_ARGS, type WriteToolName } from "../agent/tools/schemas.js";
import type { ActionArgs, PendingAction, SessionState } from "../agent/types.js";
import { type Booking, CalendarUnavailableError } from "../ports/calendar.js";
import { insideChangeWindow, recheckSlot } from "./availability.js";
import { type GateDeps, PENDING_TTL_MS } from "./deps.js";
import { readBack } from "./summary.js";

type Failure = Extract<ToolResult, { ok: false }>;
export type ProposeResult = { ok: true; action: PendingAction } | Failure;

interface Resolved {
  args: ActionArgs;
  slot?: Slot;
  reservation?: Booking;
}

/**
 * Gate step 1 (spec §6): validates a write tool call and stores it as the session's one
 * pending action. Never writes to Calendar. Policy violations throw HandoffSignal.
 */
export async function propose(
  deps: GateDeps,
  session: SessionState,
  turnId: string,
  name: WriteToolName,
  rawArgs: unknown,
): Promise<ProposeResult> {
  try {
    const resolved = await resolve(deps, session, name, rawArgs);
    if ("error" in resolved) return resolved;
    const now = deps.clock.now();
    const draft: PendingAction = {
      id: deps.ids("act"),
      sessionId: session.id,
      ...resolved,
      summary: "",
      proposedTurn: session.turn,
      expiresAt: new Date(now.getTime() + PENDING_TTL_MS).toISOString(),
    };
    const action = { ...draft, summary: readBack(draft, deps.config) };
    const previous = await deps.sessions.getPending(session.id);
    // Audit before storing: if the audit write fails, nothing becomes confirmable.
    await deps.audit.append({
      at: now.toISOString(),
      sessionId: session.id,
      turnId,
      actionId: action.id,
      kind: action.args.kind,
      stage: "proposed",
      args: action.args,
    });
    await deps.sessions.putPending(action);
    if (previous) {
      // The new action is already stored and will be read back; a failed note about the old
      // one must not abort the turn and leave an unheard action confirmable.
      await deps.audit
        .append({
          at: now.toISOString(),
          sessionId: session.id,
          turnId,
          actionId: previous.id,
          kind: previous.args.kind,
          stage: "voided",
          args: previous.args,
          reason: "superseded",
        })
        .catch(() => undefined);
    }
    return { ok: true, action };
  } catch (error) {
    if (error instanceof CalendarUnavailableError) throw new HandoffSignal("calendar_unavailable");
    throw error;
  }
}

async function resolve(
  deps: GateDeps,
  session: SessionState,
  name: WriteToolName,
  rawArgs: unknown,
): Promise<Resolved | Failure> {
  const { config, clock } = deps;
  const now = clock.now();

  const knownReservation = async (id: string): Promise<Booking | Failure> => {
    if (!Object.hasOwn(session.knownReservations, id)) {
      return fail(
        "unknown_reservation",
        "Use a reservationId returned by find_reservation.",
      ) as Failure;
    }
    const fresh = await deps.calendar.getReservation(id);
    if (!fresh) return fail("reservation_gone", "That reservation no longer exists.") as Failure;
    if (insideChangeWindow(config, fresh.start, now)) throw new HandoffSignal("late_change");
    return fresh;
  };
  const offeredSlot = (id: string): Slot | Failure =>
    Object.hasOwn(session.offeredSlots, id)
      ? session.offeredSlots[id]!
      : (fail("unknown_slot", "Use a slotId returned by check_availability.") as Failure);
  const stillFree = async (slot: Slot, excludeId?: string): Promise<Failure | undefined> =>
    (await recheckSlot(config, deps.calendar, slot, now, excludeId)).free
      ? undefined
      : (fail(
          "slot_taken",
          "That time is no longer available; check availability again.",
        ) as Failure);

  switch (name) {
    case "book": {
      const parsed = TOOL_ARGS.book.safeParse(rawArgs);
      if (!parsed.success) return fail("invalid_args", parsed.error.message) as Failure;
      const args = parsed.data;
      if (args.partySize > agentPartyLimit(config)) throw new HandoffSignal("party_too_large");
      const slot = offeredSlot(args.slotId);
      if ("error" in slot) return slot;
      if (slot.partySize !== args.partySize) {
        return fail(
          "party_mismatch",
          `That slot is for ${slot.partySize}; check availability for ${args.partySize}.`,
        ) as Failure;
      }
      const taken = await stillFree(slot);
      if (taken) return taken;
      return { args: { kind: "book", ...args }, slot };
    }
    case "reschedule": {
      const parsed = TOOL_ARGS.reschedule.safeParse(rawArgs);
      if (!parsed.success) return fail("invalid_args", parsed.error.message) as Failure;
      const args = parsed.data;
      const reservation = await knownReservation(args.reservationId);
      if ("error" in reservation) return reservation;
      const slot = offeredSlot(args.slotId);
      if ("error" in slot) return slot;
      if (slot.partySize !== reservation.partySize) {
        return fail(
          "party_mismatch",
          `The reservation is for ${reservation.partySize}; check availability for that party size.`,
        ) as Failure;
      }
      const taken = await stillFree(slot, reservation.id);
      if (taken) return taken;
      return { args: { kind: "reschedule", ...args }, slot, reservation };
    }
    case "cancel": {
      const parsed = TOOL_ARGS.cancel.safeParse(rawArgs);
      if (!parsed.success) return fail("invalid_args", parsed.error.message) as Failure;
      const reservation = await knownReservation(parsed.data.reservationId);
      if ("error" in reservation) return reservation;
      return { args: { kind: "cancel", ...parsed.data }, reservation };
    }
  }
}
