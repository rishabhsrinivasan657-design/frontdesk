import {
  type Classification,
  type Decision,
  classifyConfirmation,
  ruleDecision,
} from "../gate/classify.js";
import { confirmAndExecute, voidPending } from "../gate/execute.js";
import { propose } from "../gate/propose.js";
import { EXPIRED_REPLY } from "../gate/summary.js";
import { LLMError } from "../llm/errors.js";
import type { ToolCall } from "../llm/types.js";
import { type Calendar, type CalendarReader, CalendarUnavailableError } from "../ports/calendar.js";
import type { ServerMessage } from "../protocol/messages.js";
import type { AgentDeps } from "./deps.js";
import { alreadyHandedOffMessage, handOff } from "./handoff.js";
import { TURN_TEMPLATE, renderSystemPrompt } from "./prompt.js";
import { HandoffSignal, fail, runReadTool, type ToolResult } from "./tools/read-tools.js";
import { TOOL_SPECS, isWriteTool } from "./tools/schemas.js";
import { type HandoffReason, type PendingAction, type SessionState, newSession } from "./types.js";

export const MAX_TOOL_ROUNDS = 4;
export const FALLBACK_REPLY = "Sorry, I got stuck on that — could you say it another way?";

export type TurnFlag =
  | "classifier_error"
  | "email_failed"
  | "audit_failed"
  | "injection_pattern"
  | "meta_missing"
  | "grounding_regenerated";

export interface TurnInput {
  sessionId: string;
  text: string;
}

export interface TurnResult {
  turnId: string;
  reply: string;
  messages: ServerMessage[];
  flags: TurnFlag[];
  handoff?: HandoffReason;
  decision?: Decision;
}

/** A frozen view with only Calendar's read methods: read tools can't reach a write. */
export function readOnlyCalendar(calendar: Calendar): CalendarReader {
  return Object.freeze({
    listReservations: (range: { from: Date; to: Date }) => calendar.listReservations(range),
    getReservation: (id: string) => calendar.getReservation(id),
    findReservations: (query: { name: string; contact: string }) =>
      calendar.findReservations(query),
  });
}

interface Turn {
  deps: AgentDeps;
  session: SessionState;
  turnId: string;
  text: string;
  send: (m: ServerMessage) => void;
  flags: TurnFlag[];
  metrics: {
    llmTtftMs?: number;
    llmTotalMs: number;
    toolMs: number[];
    tokensIn: number;
    tokensOut: number;
  };
  /** True once the caller's text is in the model history. */
  userInHistory: boolean;
  /** True once the reply is in the model history (the LLM wrote it). */
  replyInHistory: boolean;
  decision?: Decision;
  handoff?: HandoffReason;
}

/**
 * One caller turn (spec §3, §6). A pending action is resolved first: only a `confirm`
 * classification reaches `confirmAndExecute`. Otherwise the model runs with the tools;
 * a write tool only proposes, and the turn ends with the deterministic read-back.
 */
export async function runTurn(
  deps: AgentDeps,
  input: TurnInput,
  emit: (m: ServerMessage) => void = () => {},
): Promise<TurnResult> {
  const startedMs = deps.clock.now().getTime();
  const turnId = deps.ids("turn");
  const messages: ServerMessage[] = [];
  const session =
    (await deps.sessions.load(input.sessionId)) ?? newSession(input.sessionId, deps.clock.now());
  session.turn += 1;
  session.transcript.push({ role: "caller", text: input.text, turnId });
  const turn: Turn = {
    deps,
    session,
    turnId,
    text: input.text,
    send: (m) => {
      messages.push(m);
      emit(m);
    },
    flags: [],
    metrics: { llmTotalMs: 0, toolMs: [], tokensIn: 0, tokensOut: 0 },
    userInHistory: false,
    replyInHistory: false,
  };

  const reply = session.handoff ? alreadyHandedOffMessage(deps.config) : await handle(turn);

  if (!turn.userInHistory) session.history.push({ role: "user", text: input.text });
  if (!turn.replyInHistory) session.history.push({ role: "assistant", text: reply });
  for (const sentence of splitSentences(reply))
    turn.send({ type: "agent_sentence", turnId, text: sentence });
  turn.send({
    type: "turn_metrics",
    turnId,
    ...turn.metrics,
    totalMs: deps.clock.now().getTime() - startedMs,
  });
  session.transcript.push({ role: "agent", text: reply, turnId });
  await deps.sessions.save(session);
  return {
    turnId,
    reply,
    messages,
    flags: turn.flags,
    ...(turn.handoff ? { handoff: turn.handoff } : {}),
    ...(turn.decision ? { decision: turn.decision } : {}),
  };
}

async function handle(turn: Turn): Promise<string> {
  try {
    const pending = await turn.deps.sessions.getPending(turn.session.id);
    if (pending) {
      const resolved = await resolvePending(turn, pending);
      if (resolved !== undefined) return resolved;
    }
    return await modelTurn(turn);
  } catch (error) {
    if (error instanceof HandoffSignal) return handOffTurn(turn, error.reason, error.summary);
    if (error instanceof CalendarUnavailableError) return handOffTurn(turn, "calendar_unavailable");
    if (error instanceof LLMError) {
      return handOffTurn(turn, error.code === "rate_limited" ? "rate_limited" : "llm_unavailable");
    }
    throw error;
  }
}

function handOffTurn(turn: Turn, reason: HandoffReason, summary?: string): Promise<string> {
  turn.handoff = reason;
  return handOff(turn.deps, turn.session, turn.turnId, reason, turn.send, summary);
}

/** Returns the reply when the pending action settles the turn, else undefined (run the model). */
async function resolvePending(turn: Turn, pending: PendingAction): Promise<string | undefined> {
  const { deps, session, turnId } = turn;
  const voided = (reason: string) =>
    turn.send({
      type: "action_result",
      turnId,
      actionId: pending.id,
      kind: pending.args.kind,
      status: "voided",
      reason,
    });

  if (deps.clock.now().getTime() >= Date.parse(pending.expiresAt)) {
    await voidPending(deps, session.id, turnId, "expired");
    voided("expired");
    return ruleDecision(turn.text) === "confirm" ? EXPIRED_REPLY : undefined;
  }

  const classification: Classification = await classifyConfirmation(deps.llm, pending, turn.text);
  turn.decision = classification.decision;
  if (classification.error) turn.flags.push("classifier_error");

  switch (classification.decision) {
    case "confirm": {
      const outcome = await confirmAndExecute(deps, session.id, pending.id, turnId);
      turn.send({
        type: "action_result",
        turnId,
        actionId: pending.id,
        kind: pending.args.kind,
        status: outcome.status,
        ...(outcome.status === "failed" ? { reason: outcome.reason } : {}),
      });
      if (outcome.status === "executed") {
        if (outcome.emailFailed) turn.flags.push("email_failed");
        if (outcome.auditFailed) turn.flags.push("audit_failed");
        return outcome.reply;
      }
      for (const slot of outcome.alternatives ?? []) session.offeredSlots[slot.id] = slot;
      if (outcome.reason === "calendar_unavailable" || outcome.reason === "late_change") {
        throw new HandoffSignal(outcome.reason);
      }
      return outcome.reply;
    }
    case "deny":
    case "change":
      await voidPending(deps, session.id, turnId, classification.decision);
      voided(classification.decision);
      return undefined;
    case "unrelated":
      return undefined;
  }
}

async function modelTurn(turn: Turn): Promise<string> {
  const { deps, session } = turn;
  session.history.push({ role: "user", text: turn.text });
  turn.userInHistory = true;
  const system = renderSystemPrompt(deps.config, deps.clock.now());
  const reader = readOnlyCalendar(deps.calendar);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const { text, calls } = await streamRound(turn, system);
    session.history.push({
      role: "assistant",
      text,
      ...(calls.length ? { toolCalls: calls } : {}),
    });
    if (calls.length === 0) {
      turn.replyInHistory = true;
      return text.trim() || FALLBACK_REPLY;
    }

    let proposed: PendingAction | undefined;
    for (const call of calls) {
      const started = deps.clock.now().getTime();
      let result: ToolResult;
      if (isWriteTool(call.name)) {
        if (proposed) {
          result = fail("one_action_at_a_time", "Only one change can be proposed at a time.");
        } else {
          const outcome = await propose(deps, session, turn.turnId, call.name, call.args);
          if (outcome.ok) {
            proposed = outcome.action;
            result = {
              ok: true,
              data: { status: "awaiting_confirmation", summary: outcome.action.summary },
            };
          } else {
            result = outcome;
          }
        }
      } else {
        result = await runReadTool(call.name, call.args, {
          config: deps.config,
          calendar: reader,
          clock: deps.clock,
          session,
        });
      }
      turn.metrics.toolMs.push(deps.clock.now().getTime() - started);
      session.history.push({ role: "tool", callId: call.id, name: call.name, result });
    }

    if (proposed) {
      turn.send({
        type: "pending_action",
        turnId: turn.turnId,
        actionId: proposed.id,
        kind: proposed.args.kind,
        summary: proposed.summary,
        expiresAt: proposed.expiresAt,
      });
      return proposed.summary;
    }
  }
  return FALLBACK_REPLY;
}

async function streamRound(
  turn: Turn,
  system: string,
): Promise<{ text: string; calls: ToolCall[] }> {
  const { deps, metrics } = turn;
  const started = deps.clock.now().getTime();
  let text = "";
  const calls: ToolCall[] = [];
  for await (const chunk of deps.llm.stream({
    purpose: "turn",
    template: TURN_TEMPLATE,
    system,
    messages: turn.session.history,
    tools: TOOL_SPECS,
  })) {
    metrics.llmTtftMs ??= deps.clock.now().getTime() - started;
    if (chunk.type === "text") text += chunk.text;
    else if (chunk.type === "tool_call") calls.push(chunk.call);
    else {
      metrics.tokensIn += chunk.usage.inputTokens;
      metrics.tokensOut += chunk.usage.outputTokens;
    }
  }
  metrics.llmTotalMs += deps.clock.now().getTime() - started;
  return { text, calls };
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
