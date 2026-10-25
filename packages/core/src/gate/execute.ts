import type { Slot } from "../availability/types.js";
import type { PendingAction } from "../agent/types.js";
import type { Booking } from "../ports/calendar.js";
import { insideChangeWindow, recheckSlot } from "./availability.js";
import { type GateDeps, SLOT_LOCK_TTL_MS } from "./deps.js";
import {
  AUDIT_FAILED_REPLY,
  CALENDAR_DOWN_REPLY,
  EXPIRED_REPLY,
  NOTHING_PENDING_REPLY,
  RESERVATION_CHANGED_REPLY,
  RESERVATION_GONE_REPLY,
  executedReply,
  lateChangeReply,
  slotGoneReply,
} from "./summary.js";

export type FailureReason =
  | "slot_taken"
  | "slot_locked"
  | "calendar_unavailable"
  | "late_change"
  | "not_pending"
  | "reservation_gone"
  | "reservation_changed"
  | "audit_failed";

export type ExecutionOutcome =
  | {
      status: "executed";
      action: PendingAction;
      booking: Booking;
      reply: string;
      emailFailed?: true;
      auditFailed?: true;
    }
  | {
      status: "failed";
      action?: PendingAction;
      reason: FailureReason;
      reply: string;
      alternatives?: Slot[];
    };

type VoidReason =
  "deny" | "change" | "expired" | "superseded" | "handoff" | "error" | "interrupted";

class SlotGone extends Error {
  constructor(
    readonly reason: "slot_taken" | "slot_locked",
    readonly alternatives: Slot[],
  ) {
    super(reason);
  }
}

/**
 * Gate step 3 (spec §6): the ONLY code path to a Calendar write. Executes the session's
 * pending action iff `actionId` is still that action and it has not expired. The pending
 * action is taken atomically first, so a repeated confirm can't execute twice.
 */
export async function confirmAndExecute(
  deps: GateDeps,
  sessionId: string,
  actionId: string,
  turnId: string,
): Promise<ExecutionOutcome> {
  const action = await deps.sessions.takePending(sessionId, actionId);
  if (!action) return { status: "failed", reason: "not_pending", reply: NOTHING_PENDING_REPLY };
  const audit = auditor(deps, action, turnId);

  if (deps.clock.now().getTime() >= Date.parse(action.expiresAt)) {
    await audit("voided", { reason: "expired" }).catch(() => undefined);
    return { status: "failed", action, reason: "not_pending", reply: EXPIRED_REPLY };
  }
  try {
    await audit("confirmed");
  } catch {
    return { status: "failed", action, reason: "audit_failed", reply: AUDIT_FAILED_REPLY };
  }

  const failed = async (
    reason: FailureReason,
    reply: string,
    alternatives?: Slot[],
  ): Promise<ExecutionOutcome> => {
    await audit("failed", { reason }).catch(() => undefined);
    return { status: "failed", action, reason, reply, alternatives };
  };

  let booking: Booking;
  try {
    const result = await write(deps, action);
    if (result === "reservation_gone") return failed(result, RESERVATION_GONE_REPLY);
    if (result === "reservation_changed") return failed(result, RESERVATION_CHANGED_REPLY);
    if (result === "late_change") return failed(result, lateChangeReply(deps.config));
    booking = result;
  } catch (error) {
    if (error instanceof SlotGone) {
      return failed(
        error.reason,
        slotGoneReply(action, error.alternatives, deps.config),
        error.alternatives,
      );
    }
    return failed("calendar_unavailable", CALENDAR_DOWN_REPLY);
  }

  const outcome: Extract<ExecutionOutcome, { status: "executed" }> = {
    status: "executed",
    action,
    booking,
    reply: "",
  };
  try {
    await audit("executed", { result: booking });
  } catch {
    outcome.auditFailed = true;
  }
  let emailed = false;
  if (booking.contact.includes("@")) {
    try {
      await deps.mailer.sendConfirmation({
        kind: action.args.kind,
        to: booking.contact,
        booking,
        businessName: deps.config.business.name,
        sessionId: action.sessionId,
        actionId: action.id,
      });
      emailed = true;
    } catch {
      outcome.emailFailed = true;
    }
  }
  outcome.reply = executedReply(action, booking, deps.config, emailed);
  return outcome;
}

/** Clears the session's pending action, if any, and audits it as voided. */
export async function voidPending(
  deps: GateDeps,
  sessionId: string,
  turnId: string,
  reason: VoidReason,
): Promise<PendingAction | undefined> {
  const action = await deps.sessions.clearPending(sessionId);
  if (action) await auditor(deps, action, turnId)("voided", { reason });
  return action;
}

function auditor(deps: GateDeps, action: PendingAction, turnId: string) {
  return (
    stage: "confirmed" | "executed" | "failed" | "voided",
    extra: { reason?: string; result?: unknown } = {},
  ) =>
    deps.audit.append({
      at: deps.clock.now().toISOString(),
      sessionId: action.sessionId,
      turnId,
      actionId: action.id,
      kind: action.args.kind,
      stage,
      args: action.args,
      ...extra,
    });
}

/** Re-validates under the slot lock and performs the one Calendar write. */
async function write(
  deps: GateDeps,
  action: PendingAction,
): Promise<Booking | "reservation_gone" | "reservation_changed" | "late_change"> {
  const { args } = action;
  const now = deps.clock.now();
  let current: Booking | undefined;
  if (args.kind !== "book") {
    current = await deps.calendar.getReservation(args.reservationId);
    if (!current) return "reservation_gone";
    // The caller confirmed the reservation as read back; if it changed since, they didn't.
    if (!sameReservation(current, action.reservation!)) return "reservation_changed";
    if (insideChangeWindow(deps.config, current.start, now)) return "late_change";
  }
  if (args.kind === "cancel") {
    await deps.calendar.cancelReservation(current!.id);
    return current!;
  }

  const slot = action.slot!;
  const lease = await deps.locks.acquire(`slot:${slot.date}:${slot.tableId}`, SLOT_LOCK_TTL_MS);
  if (!lease) {
    const { alternatives } = await recheckSlot(deps.config, deps.calendar, slot, now, current?.id);
    throw new SlotGone("slot_locked", alternatives);
  }
  try {
    const check = await recheckSlot(deps.config, deps.calendar, slot, now, current?.id);
    if (!check.free) throw new SlotGone("slot_taken", check.alternatives);
    const placement = {
      start: new Date(slot.start),
      end: new Date(slot.end),
      tableId: slot.tableId,
    };
    if (args.kind === "book") {
      return await deps.calendar.createReservation({
        ...placement,
        partySize: args.partySize,
        name: args.name,
        contact: args.contact,
        notes: args.notes,
      });
    }
    return await deps.calendar.moveReservation(current!.id, {
      ...placement,
      partySize: slot.partySize,
    });
  } finally {
    // The write (if any) already happened; the lease's TTL frees the slot if release fails.
    await lease.release().catch(() => undefined);
  }
}

function sameReservation(a: Booking, b: Booking): boolean {
  return (
    new Date(a.start).getTime() === new Date(b.start).getTime() &&
    new Date(a.end).getTime() === new Date(b.end).getTime() &&
    a.tableId === b.tableId &&
    a.partySize === b.partySize
  );
}
