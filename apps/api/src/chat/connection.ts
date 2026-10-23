import {
  type AgentDeps,
  ClientMessageSchema,
  type ServerMessage,
  type SessionMessage,
  type TurnResult,
  alreadyHandedOffMessage,
  runTurn,
} from "@frontdesk/core";
import type { Price } from "@frontdesk/llm";
import { toTurnRecord } from "../metrics/turn-record.js";
import type { ConversationLog } from "./conversation-log.js";
import type { SessionHub } from "./hub.js";
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
  const existing = requestedSessionId ? await deps.sessions.load(requestedSessionId) : undefined;
  const sessionId = existing?.id ?? ctx.newSessionId();
  const claim = ctx.hub.claim(sessionId, socket);
  // A turn still running on the replaced socket must be saved before its state is restored.
  await claim.previousTurn;
  send(await sessionMessage(deps, sessionId, existing !== undefined));

  /** Runs one turn; resolves once its last message is sent, before the turn is stored. */
  async function runOne(text: string): Promise<{ result: TurnResult; firstOutputMs?: number }> {
    const started = performance.now();
    let firstOutputMs: number | undefined;
    const result = await runTurn(deps, { sessionId, text }, (m) => {
      if (firstOutputMs === undefined && FIRST_OUTPUT.has(m.type)) {
        firstOutputMs = performance.now() - started;
      }
      send(m);
    });
    return { result, ...(firstOutputMs !== undefined ? { firstOutputMs } : {}) };
  }

  return {
    sessionId,
    close: () => claim.release(),
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
      // interrupt and tts_started belong to voice (M7).
      if (message.type !== "user_text") return;
      if (claim.busy()) {
        send({ type: "error", code: "busy", message: "Still answering your last message." });
        return;
      }
      // Busy until the reply is complete; the turn is stored after, while the next may start.
      const end = claim.begin();
      let turn: Awaited<ReturnType<typeof runOne>>;
      try {
        turn = await runOne(message.text);
      } catch (error) {
        ctx.logger.error({ err: safeError(error), session: sessionTag(sessionId) }, "turn failed");
        send({ type: "error", code: "server_error", message: SERVER_ERROR_MESSAGE });
        return;
      } finally {
        end();
      }
      await record(
        ctx,
        sessionId,
        message.text,
        message.timings,
        turn.result,
        turn.firstOutputMs,
      ).catch((error: unknown) =>
        ctx.logger.error(
          { err: safeError(error), session: sessionTag(sessionId) },
          "storing the turn failed",
        ),
      );
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

/** Stores the turn (and the conversation on its first turn); a handoff ends the conversation. */
async function record(
  ctx: ChatContext,
  sessionId: string,
  callerText: string,
  timings: { speechEnd?: number; sttFinal?: number },
  result: TurnResult,
  firstOutputMs: number | undefined,
): Promise<void> {
  const session = await ctx.deps.sessions.load(sessionId);
  // Counted from the transcript, so a later turn that already started can't shift it.
  const callerTurns = (session?.transcript ?? []).filter((t) => t.role === "caller");
  const position = callerTurns.findIndex((t) => t.turnId === result.turnId);
  const turnIndex = position === -1 ? (session?.turn ?? 1) : position + 1;
  const now = ctx.deps.clock.now();
  if (turnIndex === 1) {
    await ctx.log.start({
      id: sessionId,
      source: "live",
      startedAt: session?.createdAt ?? now.toISOString(),
    });
  }
  await ctx.log.recordTurn(
    toTurnRecord({
      id: result.turnId,
      conversationId: sessionId,
      turnIndex,
      callerText,
      result,
      timings,
      ...(firstOutputMs !== undefined ? { firstOutputMs } : {}),
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
