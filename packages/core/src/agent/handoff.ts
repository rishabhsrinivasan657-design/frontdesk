import type { BusinessConfig } from "../config/schema.js";
import { voidPending } from "../gate/execute.js";
import type { ServerMessage } from "../protocol/messages.js";
import type { AgentDeps } from "./deps.js";
import type { HandoffReason, SessionState } from "./types.js";

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
  await deps.handoffs.enqueue({
    id: deps.ids("handoff"),
    sessionId: session.id,
    reason,
    summary: summary ?? `Handoff (${reason}) after: ${lastCaller}`,
    transcript: session.transcript,
    createdAt: now,
  });
  session.handoff = { reason, at: now };
  const message = handoffMessage(deps.config);
  send({ type: "handoff", turnId, reason, message });
  return message;
}
