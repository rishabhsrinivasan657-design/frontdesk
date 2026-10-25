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
import {
  CONFIDENCE_THRESHOLD,
  HUMAN_OFFER,
  OFF_TOPIC_LIMIT,
  RATE_LIMIT_MAX_WAIT_MS,
  TOOL_FAILURE_LIMIT,
  type Meta,
  parseMeta,
} from "../guardrails/meta.js";
import {
  type Claim,
  buildFacts,
  groundingNote,
  recordCallerValues,
  ungrounded,
} from "../guardrails/grounding.js";
import { looksLikeInjection, wantsHuman, wrapCallerText } from "../guardrails/untrusted.js";
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
  /**
   * The caller barged in (spec §8). Honoured only before anything is written or read back:
   * never while a pending action is classified or executed, nor after `pending_action`.
   */
  signal?: TurnSignal;
}

/** The part of an `AbortSignal` core reads (core has no DOM or Node types). */
export interface TurnSignal {
  readonly aborted: boolean;
}

/** The turn was cancelled by its signal; the session is left as it was before the turn. */
export class TurnInterrupted extends Error {
  constructor() {
    super("turn interrupted");
    this.name = "TurnInterrupted";
  }
}

export interface TurnResult {
  turnId: string;
  reply: string;
  messages: ServerMessage[];
  flags: TurnFlag[];
  handoff?: HandoffReason;
  decision?: Decision;
  /** Every tool the model called this turn, in order. No args: they can hold contact details. */
  toolCalls: ToolCallRecord[];
}

export interface ToolCallRecord {
  name: string;
  ms: number;
  ok: boolean;
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
  signal?: TurnSignal;
  send: (m: ServerMessage) => void;
  flags: TurnFlag[];
  metrics: {
    llmTtftMs?: number;
    llmTotalMs: number;
    toolMs: number[];
    tokensIn: number;
    tokensOut: number;
  };
  toolCalls: ToolCallRecord[];
  /** True once the caller's text is in the model history. */
  userInHistory: boolean;
  /** True once the reply is in the model history (the LLM wrote it). */
  replyInHistory: boolean;
  decision?: Decision;
  handoff?: HandoffReason;
  waitedForRateLimit?: boolean;
  /** A pending action survived this turn's classification (still awaiting the caller). */
  pendingKept?: boolean;
  /** The action proposed this turn, if any. */
  proposedId?: string;
  messages: ServerMessage[];
}

/**
 * One caller turn (spec §3, §6). A pending action is resolved first: only a `confirm`
 * classification reaches `confirmAndExecute`. Otherwise the model runs with the tools;
 * a write tool only proposes, and the turn ends with the deterministic read-back.
 */
export function runTurn(
  deps: AgentDeps,
  input: TurnInput,
  emit: (m: ServerMessage) => void = () => {},
): Promise<TurnResult> {
  return serialized(deps.sessions, input.sessionId, () => runTurnNow(deps, input, emit));
}

/**
 * Turns on one session run one at a time: concurrent turns would each load, change and save
 * the session, and the last save would drop the other's state (a handoff, a pending action).
 * This covers one process; a multi-process host (M6) must also hold a per-session lock.
 */
const queues = new WeakMap<object, Map<string, Promise<unknown>>>();
function serialized<T>(scope: object, sessionId: string, fn: () => Promise<T>): Promise<T> {
  let byId = queues.get(scope);
  if (!byId) queues.set(scope, (byId = new Map<string, Promise<unknown>>()));
  const previous = byId.get(sessionId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  const settled = next.catch(() => undefined);
  byId.set(sessionId, settled);
  void settled.then(() => {
    if (byId.get(sessionId) === settled) byId.delete(sessionId);
  });
  return next;
}

async function runTurnNow(
  deps: AgentDeps,
  input: TurnInput,
  emit: (m: ServerMessage) => void,
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
    ...(input.signal ? { signal: input.signal } : {}),
    send: (m) => {
      messages.push(m);
      emit(m);
    },
    flags: [],
    metrics: { llmTotalMs: 0, toolMs: [], tokensIn: 0, tokensOut: 0 },
    toolCalls: [],
    userInHistory: false,
    replyInHistory: false,
    messages,
  };

  try {
    return await finishTurn(turn, startedMs);
  } catch (error) {
    // A read-back the caller never heard must not stay confirmable.
    if (turn.proposedId) {
      const pending = await deps.sessions.getPending(session.id).catch(() => undefined);
      if (pending?.id === turn.proposedId) {
        const reason = error instanceof TurnInterrupted ? "interrupted" : "error";
        await voidPending(deps, session.id, turnId, reason).catch(() => undefined);
      }
    }
    throw error;
  }
}

async function finishTurn(turn: Turn, startedMs: number): Promise<TurnResult> {
  const { deps, session, turnId, text } = turn;
  const reply = session.handoff ? alreadyHandedOffMessage(deps.config) : await handle(turn);

  if (!turn.userInHistory) session.history.push({ role: "user", text: wrapCallerText(text) });
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
    flags: turn.flags,
    messages: turn.messages,
    toolCalls: turn.toolCalls,
    ...(turn.handoff ? { handoff: turn.handoff } : {}),
    ...(turn.decision ? { decision: turn.decision } : {}),
  };
}

async function handle(turn: Turn): Promise<string> {
  try {
    if (looksLikeInjection(turn.text)) turn.flags.push("injection_pattern");
    recordCallerValues(turn.session, turn.text);
    if (wantsHuman(turn.text)) {
      throw new HandoffSignal("human_requested", "Caller asked for a person.");
    }
    const pending = await turn.deps.sessions.getPending(turn.session.id);
    // The offer stands for the next reply only (after 3 off-topic turns).
    const offered = turn.session.humanOffered;
    turn.session.humanOffered = false;
    if (offered && !pending && ruleDecision(turn.text) === "confirm") {
      throw new HandoffSignal(
        "human_requested",
        "Accepted the offer of a person after off-topic turns.",
      );
    }
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
    // A caller saying yes to an expired action must hear that nothing happened.
    const late = await classify(turn, pending);
    return late.decision === "confirm" ? EXPIRED_REPLY : undefined;
  }

  const classification = await classify(turn, pending);

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
        // A booking made or moved in this call can be changed later in the same call.
        if (pending.args.kind === "cancel") delete session.knownReservations[outcome.booking.id];
        else session.knownReservations[outcome.booking.id] = outcome.booking;
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
      turn.pendingKept = true;
      return undefined;
  }
}

async function classify(turn: Turn, pending: PendingAction): Promise<Classification> {
  const classification = await classifyConfirmation(turn.deps.llm, pending, turn.text);
  turn.decision = classification.decision;
  if (classification.error) turn.flags.push("classifier_error");
  return classification;
}

async function modelTurn(turn: Turn): Promise<string> {
  const { deps, session } = turn;
  session.history.push({ role: "user", text: wrapCallerText(turn.text) });
  turn.userInHistory = true;
  let system = renderSystemPrompt(deps.config, deps.clock.now());
  const reader = readOnlyCalendar(deps.calendar);
  let rounds = MAX_TOOL_ROUNDS;

  for (let round = 0; round < rounds; round++) {
    const { text, calls } = await streamWithWait(turn, system);
    if (calls.length === 0) {
      const checked = checkDraft(turn, text);
      if ("regenerate" in checked) {
        // Spec §6: regenerate once with a note; the bad draft never reaches the history.
        if (turn.flags.includes("grounding_regenerated"))
          throw new HandoffSignal("grounding_failed");
        turn.flags.push("grounding_regenerated");
        system = `${system}\n${groundingNote(checked.regenerate)}`;
        rounds += 1;
        continue;
      }
      session.history.push({ role: "assistant", text });
      turn.replyInHistory = true;
      return finalReply(turn, checked.meta);
    }
    session.history.push({ role: "assistant", text, toolCalls: calls });

    let proposed: PendingAction | undefined;
    for (const call of calls) {
      checkpoint(turn);
      const started = deps.clock.now().getTime();
      let result: ToolResult;
      if (isWriteTool(call.name)) {
        if (proposed) {
          result = fail("one_action_at_a_time", "Only one change can be proposed at a time.");
        } else {
          const outcome = await propose(deps, session, turn.turnId, call.name, call.args);
          if (outcome.ok) {
            proposed = outcome.action;
            turn.proposedId = outcome.action.id;
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
      const ms = deps.clock.now().getTime() - started;
      turn.metrics.toolMs.push(ms);
      turn.toolCalls.push({ name: call.name, ms, ok: result.ok });
      countToolResult(turn, result.ok);
      session.history.push({ role: "tool", callId: call.id, name: call.name, result });
    }

    if (proposed) {
      // Last safe point: once the read-back is sent, the caller may say yes to it.
      checkpoint(turn);
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
  countToolResult(turn, false);
  return FALLBACK_REPLY;
}

/** Spec §6: 2 failed tool attempts in a row hand off; any success resets the count. */
function countToolResult(turn: Turn, ok: boolean): void {
  const counters = turn.session.counters;
  counters.toolFailuresInARow = ok ? 0 : counters.toolFailuresInARow + 1;
  if (counters.toolFailuresInARow >= TOOL_FAILURE_LIMIT) throw new HandoffSignal("tool_failures");
}

/** Low confidence hands off; then every stated value must be grounded (spec §6). */
function checkDraft(turn: Turn, draft: string): { meta: Meta } | { regenerate: Claim[] } {
  const meta = parseMeta(draft);
  if (meta.confidence < CONFIDENCE_THRESHOLD) throw new HandoffSignal("low_confidence");
  const facts = buildFacts(turn.deps.config, turn.session, turn.deps.clock.now());
  const claims = ungrounded(meta.body, facts);
  return claims.length > 0 ? { regenerate: claims } : { meta };
}

/** Applies the accepted draft's meta line: off-topic turns count toward offering a human. */
function finalReply(turn: Turn, meta: Meta): string {
  if (meta.missing) turn.flags.push("meta_missing");
  const reply = meta.body || FALLBACK_REPLY;
  const session = turn.session;
  if (meta.onTopic) {
    session.counters.offTopic = 0;
    return reply;
  }
  session.counters.offTopic += 1;
  // While a read-back waits, a "yes" must mean that action, so the offer waits too.
  if (session.counters.offTopic < OFF_TOPIC_LIMIT || turn.pendingKept) return reply;
  session.counters.offTopic = 0;
  session.humanOffered = true;
  return `${reply} ${HUMAN_OFFER}`;
}

/** Spec §7/§11: on a short rate limit say "one moment", wait once, retry; otherwise hand off. */
async function streamWithWait(
  turn: Turn,
  system: string,
): Promise<{ text: string; calls: ToolCall[] }> {
  try {
    return await streamRound(turn, system);
  } catch (error) {
    const wait =
      error instanceof LLMError && error.code === "rate_limited" ? error.retryAfterMs : undefined;
    if (turn.waitedForRateLimit || wait === undefined || wait > RATE_LIMIT_MAX_WAIT_MS) throw error;
    turn.waitedForRateLimit = true;
    turn.send({ type: "agent_sentence", turnId: turn.turnId, text: "One moment." });
    await turn.deps.clock.sleep(wait);
    return streamRound(turn, system);
  }
}

async function streamRound(
  turn: Turn,
  system: string,
): Promise<{ text: string; calls: ToolCall[] }> {
  const { deps, metrics } = turn;
  checkpoint(turn);
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
    checkpoint(turn);
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

/** A safe point to stop: nothing this turn has written is confirmable or heard yet. */
function checkpoint(turn: Turn): void {
  if (turn.signal?.aborted) throw new TurnInterrupted();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
