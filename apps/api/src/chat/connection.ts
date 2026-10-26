import {
  type AgentDeps,
  ClientMessageSchema,
  type ServerMessage,
  type SessionMessage,
  TurnInterrupted,
  type TurnResult,
  alreadyHandedOffMessage,
  runTurn,
} from "@frontdesk/core";
import type { Price } from "@frontdesk/llm";
import { overBudgetFlags } from "../metrics/latency.js";
import { toTurnRecord } from "../metrics/turn-record.js";
import type { OwnerFeed } from "../owner/feed.js";
import type { ConversationLog } from "./conversation-log.js";
import type { SessionHub, Turn } from "./hub.js";
import { safeError, sessionTag } from "./log-safety.js";

export interface ChatContext {
  deps: AgentDeps;
  log: ConversationLog;
  /** Price of the active model, for each turn's cost_usd. */
  price: Price;
  /** A fresh, unguessable session id: it is the caller's only credential for reconnecting. */
  newSessionId: () => string;
  logger: { error(obj: unknown, msg: string): void };
  hub: SessionHub;
  /** A monotonic ms clock for voice timings; defaults to `performance.now`. */
  monotonicMs?: () => number;
  /** The owner's Live view hears about sessions, turns and read-backs here. */
  feed?: OwnerFeed;
  /** Where conversations are counted (spec §10); `pilot` in production. Defaults to `live`. */
  source?: "live" | "pilot";
}

export interface ChatSocket {
  send(text: string): void;
  close(code?: number): void;
}

export interface Chat {
  sessionId: string;
  onMessage(raw: string): Promise<void>;
  /** The socket closed: frees the session for the next one. */
  close(): void;
}

export const SERVER_ERROR_MESSAGE = "Sorry, something went wrong. Please try again.";
const FIRST_OUTPUT = new Set<ServerMessage["type"]>([
  "agent_delta",
  "agent_sentence",
  "pending_action",
  "handoff",
]);

/**
 * Binds one socket to one session (spec §8, §11). A known `requestedSessionId` resumes that
 * session from the store; anything else gets a fresh server-issued id. The only thing a client
 * can do is send caller text: it reaches `runTurn` as text, and the gate decides what it means.
 */
export async function openChat(
  socket: ChatSocket,
  ctx: ChatContext,
  requestedSessionId?: string,
): Promise<Chat> {
  const { deps } = ctx;
  const send = (m: ServerMessage) => socket.send(JSON.stringify(m));
  // A turn still running for this session (on a closed or replaced socket) must be saved
  // before its state is read; on a brand-new session it is the first save.
  if (requestedSessionId) await ctx.hub.settled(requestedSessionId);
  const existing = requestedSessionId ? await deps.sessions.load(requestedSessionId) : undefined;
  const sessionId = existing?.id ?? ctx.newSessionId();
  const claim = ctx.hub.claim(sessionId, socket);
  const at = () => deps.clock.now().toISOString();
  ctx.feed?.publish({ type: "session_open", sessionId, at: at() });
  await ctx.hub.settled(sessionId);
  send(await sessionMessage(deps, sessionId, existing !== undefined));
  const now = ctx.monotonicMs ?? (() => performance.now());

  /** The turn in flight on this socket, which `interrupt` can cancel. */
  let current: { controller: AbortController; settled: Promise<void> } | undefined;
  // Voice: when each turn's first sentence went out, and its measured TTS start (spec §8).
  const firstSentenceAt = new Map<string, number>();
  const ttsStartMs = new Map<string, number>();
  const recorded = new Set<string>();

  const storeTtsStart = (turnId: string, ms: number) =>
    ctx.log
      .setTtsStart(
        sessionId,
        turnId,
        Math.round(ms),
        overBudgetFlags({ toolMs: [], ttsStartMs: ms }),
      )
      .catch((error: unknown) =>
        ctx.logger.error(
          { err: safeError(error), session: sessionTag(sessionId) },
          "storing tts start failed",
        ),
      );

  /** Only turns this socket ran, and only the first report each: a client can't touch others. */
  async function onTtsStarted(turnId: string): Promise<void> {
    const sentAt = firstSentenceAt.get(turnId);
    if (sentAt === undefined || ttsStartMs.has(turnId)) return;
    const ms = Math.max(0, now() - sentAt);
    ttsStartMs.set(turnId, ms);
    if (recorded.has(turnId)) await storeTtsStart(turnId, ms);
  }

  /** The caller's rating for this session only; a repeat is acknowledged but not stored. */
  async function onFeedback(rating: number, comment: string): Promise<void> {
    const saved = await ctx.log
      .saveFeedback({
        id: deps.ids("fb"),
        conversationId: sessionId,
        rating,
        comment: comment.trim(),
        createdAt: at(),
      })
      .catch((error: unknown) => {
        ctx.logger.error(
          { err: safeError(error), session: sessionTag(sessionId) },
          "storing feedback failed",
        );
        return "failed" as const;
      });
    if (saved === "no_conversation") {
      send({ type: "error", code: "bad_message", message: "There's no conversation to rate yet." });
      return;
    }
    if (saved === "failed") {
      send({ type: "error", code: "server_error", message: SERVER_ERROR_MESSAGE });
      return;
    }
    send({ type: "feedback_saved" });
  }

  /** Runs one turn; resolves once its last message is sent, before the turn is stored. */
  async function runOne(
    text: string,
    turn: Turn,
    signal: AbortSignal,
  ): Promise<{ result: TurnResult; firstOutputMs?: number }> {
    const started = performance.now();
    let firstOutputMs: number | undefined;
    const result = await runTurn(deps, { sessionId, text, signal }, (m) => {
      if (firstOutputMs === undefined && FIRST_OUTPUT.has(m.type)) {
        firstOutputMs = performance.now() - started;
      }
      // The caller has the whole reply and may answer at once; core queues that turn behind
      // this one's save.
      if (m.type === "agent_sentence" && !firstSentenceAt.has(m.turnId)) {
        firstSentenceAt.set(m.turnId, now());
      }
      if (m.type === "turn_metrics") turn.replied();
      if (m.type === "pending_action") {
        ctx.feed?.publish({
          type: "pending",
          sessionId,
          summary: m.summary,
          expiresAt: m.expiresAt,
        });
      }
      if (m.type === "action_result") {
        ctx.feed?.publish({ type: "pending_cleared", sessionId, status: m.status });
      }
      if (m.type === "handoff") ctx.feed?.publish({ type: "handoff", sessionId, reason: m.reason });
      send(m);
    });
    return { result, ...(firstOutputMs !== undefined ? { firstOutputMs } : {}) };
  }

  return {
    sessionId,
    close: () => {
      // A socket replaced by a newer one leaves the session live.
      const wasCurrent = claim.isCurrent();
      claim.release();
      if (wasCurrent) ctx.feed?.publish({ type: "session_closed", sessionId, at: at() });
    },
    async onMessage(raw: string) {
      // A newer socket took over this session; this one is closing.
      if (!claim.isCurrent()) return;
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        json = undefined;
      }
      const parsed = ClientMessageSchema.safeParse(json);
      if (!parsed.success) {
        send({ type: "error", code: "bad_message", message: "That message wasn't understood." });
        return;
      }
      const message = parsed.data;
      if (message.type === "interrupt") {
        // Barge-in (spec §8): core stops the turn at its next safe point, if it still can.
        current?.controller.abort();
        return;
      }
      if (message.type === "tts_started") {
        await onTtsStarted(message.turnId);
        return;
      }
      if (message.type === "feedback") {
        await onFeedback(message.rating, message.comment);
        return;
      }
      // Speech that interrupted a turn waits for it to unwind instead of getting `busy`.
      if (claim.busy() && current?.controller.signal.aborted) await current.settled;
      if (claim.busy()) {
        send({ type: "error", code: "busy", message: "Still answering your last message." });
        return;
      }
      // Busy until the reply is complete; the turn is stored after, while the next may start.
      const inflight = claim.begin();
      const controller = new AbortController();
      let settle!: () => void;
      const mine = { controller, settled: new Promise<void>((r) => (settle = r)) };
      current = mine;
      let turn: Awaited<ReturnType<typeof runOne>>;
      try {
        turn = await runOne(message.text, inflight, controller.signal);
      } catch (error) {
        if (error instanceof TurnInterrupted) {
          send({ type: "interrupted" });
          return;
        }
        ctx.logger.error({ err: safeError(error), session: sessionTag(sessionId) }, "turn failed");
        send({ type: "error", code: "server_error", message: SERVER_ERROR_MESSAGE });
        return;
      } finally {
        if (current === mine) current = undefined;
        inflight.done();
        settle();
      }
      const turnId = turn.result.turnId;
      ctx.feed?.publish({
        type: "turn",
        sessionId,
        turnId,
        callerText: message.text,
        agentText: turn.result.reply,
        firstOutputMs: turn.firstOutputMs === undefined ? null : Math.round(turn.firstOutputMs),
        flags: turn.result.flags,
        at: at(),
      });
      const included = ttsStartMs.get(turnId);
      await record(ctx, sessionId, message.text, message.timings, turn.result, {
        ...(turn.firstOutputMs !== undefined ? { firstOutputMs: turn.firstOutputMs } : {}),
        ...(included !== undefined ? { ttsStartMs: included } : {}),
      }).catch((error: unknown) =>
        ctx.logger.error(
          { err: safeError(error), session: sessionTag(sessionId) },
          "storing the turn failed",
        ),
      );
      recorded.add(turnId);
      // tts_started arrived while the row was being written.
      const late = ttsStartMs.get(turnId);
      if (included === undefined && late !== undefined) await storeTtsStart(turnId, late);
    },
  };
}

async function sessionMessage(
  deps: AgentDeps,
  sessionId: string,
  resumed: boolean,
): Promise<SessionMessage> {
  const message: SessionMessage = { type: "session", sessionId, resumed, transcript: [] };
  if (!resumed) return message;
  const session = await deps.sessions.load(sessionId);
  message.transcript = (session?.transcript ?? []).map(({ role, text, turnId }) => ({
    role,
    text,
    turnId,
  }));
  const pending = await deps.sessions.getPending(sessionId);
  if (pending && deps.clock.now().getTime() < Date.parse(pending.expiresAt)) {
    message.pending = {
      actionId: pending.id,
      kind: pending.args.kind,
      summary: pending.summary,
      expiresAt: pending.expiresAt,
    };
  }
  if (session?.handoff) {
    message.handoff = {
      reason: session.handoff.reason,
      message: alreadyHandedOffMessage(deps.config),
    };
  }
  return message;
}

/** Stores the turn (starting its conversation if needed); a handoff ends the conversation. */
async function record(
  ctx: ChatContext,
  sessionId: string,
  callerText: string,
  timings: { speechEnd?: number; sttFinal?: number },
  result: TurnResult,
  latency: { firstOutputMs?: number; ttsStartMs?: number },
): Promise<void> {
  const session = await ctx.deps.sessions.load(sessionId);
  // Counted from the transcript, so a later turn that already started can't shift it.
  const callerTurns = (session?.transcript ?? []).filter((t) => t.role === "caller");
  const position = callerTurns.findIndex((t) => t.turnId === result.turnId);
  const turnIndex = position === -1 ? (session?.turn ?? 1) : position + 1;
  const now = ctx.deps.clock.now();
  // Every turn (re)starts its conversation: one failed start must not orphan the later turns.
  await ctx.log.start({
    id: sessionId,
    source: ctx.source ?? "live",
    startedAt: session?.createdAt ?? now.toISOString(),
  });
  await ctx.log.recordTurn(
    toTurnRecord({
      id: result.turnId,
      conversationId: sessionId,
      turnIndex,
      callerText,
      result,
      timings,
      ...latency,
      price: ctx.price,
      now,
    }),
  );
  if (result.handoff) {
    await ctx.log.end(sessionId, {
      endedAt: now.toISOString(),
      outcome: "handoff",
      handoffReason: result.handoff,
    });
  }
}
