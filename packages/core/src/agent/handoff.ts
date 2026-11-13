import { DateTime } from "luxon";
import type { BusinessConfig } from "../config/schema.js";
import { voidPending } from "../gate/execute.js";
import type { ServerMessage } from "../protocol/messages.js";
import type { AgentDeps } from "./deps.js";
import type { HandoffDetails, HandoffReason, PendingAction, SessionState } from "./types.js";

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /\+?\(?\d[\d\s().-]{6,}\d/g;

/**
 * What the owner needs to follow up, from the session alone: the pending action (most specific),
 * else a reservation the guest looked up, else the last availability check (date and party only:
 * a check also returns nearby times). A contact the guest typed fills in when nothing names them.
 */
export function handoffDetails(
  session: SessionState,
  config: BusinessConfig,
  pending?: PendingAction,
): HandoffDetails {
  const zone = config.business.timezone;
  const local = (at: string | Date) =>
    (typeof at === "string" ? DateTime.fromISO(at) : DateTime.fromJSDate(at)).setZone(zone);
  const day = (at: string | Date) => local(at).toFormat("cccc, LLLL d");
  const time = (at: string | Date) => local(at).toFormat("h:mm a");

  const d: HandoffDetails = {};
  if (pending) {
    const who = pending.args.kind === "book" ? pending.args : pending.reservation;
    const at = pending.slot ?? pending.reservation;
    if (who) Object.assign(d, { name: who.name, contact: who.contact });
    if (at)
      Object.assign(d, { date: day(at.start), time: time(at.start), partySize: at.partySize });
  } else {
    const known = Object.values(session.knownReservations).at(-1);
    const offered = Object.values(session.offeredSlots).at(-1);
    if (known) {
      Object.assign(d, {
        name: known.name,
        contact: known.contact,
        date: day(known.start),
        time: time(known.start),
        partySize: known.partySize,
      });
    } else if (offered) {
      Object.assign(d, { date: day(offered.start), partySize: offered.partySize });
    }
  }
  if (!d.contact) {
    const typed = session.transcript
      .filter((t) => t.role === "caller")
      .flatMap((t) => [...(t.text.match(EMAIL) ?? []), ...(t.text.match(PHONE) ?? [])])
      .at(-1);
    if (typed) d.contact = typed.trim();
  }
  return d;
}

export function handoffMessage(config: BusinessConfig): string {
  return `I'm passing this to our team at ${config.business.name}. Someone will follow up during opening hours, or you can call us at ${config.business.phone}.`;
}

export function alreadyHandedOffMessage(config: BusinessConfig): string {
  return `I've already passed this to our team at ${config.business.name}. Someone will follow up during opening hours, or you can call us at ${config.business.phone}.`;
}

/**
 * Hands the conversation to a human (spec §6): voids any pending action, queues a ticket with
 * the transcript, and closes the session to the agent. Returns the caller-facing message.
 */
export async function handOff(
  deps: AgentDeps,
  session: SessionState,
  turnId: string,
  reason: HandoffReason,
  send: (m: ServerMessage) => void,
  summary?: string,
): Promise<string> {
  const voided = await voidPending(deps, session.id, turnId, "handoff");
  if (voided) {
    send({
      type: "action_result",
      turnId,
      actionId: voided.id,
      kind: voided.args.kind,
      status: "voided",
      reason: "handoff",
    });
  }
  const lastCaller = session.transcript.filter((t) => t.role === "caller").at(-1)?.text ?? "";
  const now = deps.clock.now().toISOString();
  const details = handoffDetails(session, deps.config, voided);
  await deps.handoffs.enqueue({
    id: deps.ids("handoff"),
    sessionId: session.id,
    reason,
    summary: summary ?? `Handoff (${reason}) after: ${lastCaller}`,
    transcript: session.transcript,
    createdAt: now,
    ...(Object.keys(details).length > 0 && { details }),
  });
  session.handoff = { reason, at: now };
  const message = handoffMessage(deps.config);
  send({ type: "handoff", turnId, reason, message });
  return message;
}
