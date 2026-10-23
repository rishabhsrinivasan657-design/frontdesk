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

export interface ChatContext {
  deps: AgentDeps;
  log: ConversationLog;
  /** Price of the active model, for each turn's cost_usd. */
  price: Price;
  /** A fresh, unguessable session id: it is the caller's only credential for reconnecting. */
  newSessionId: () => string;
  logger: { error(obj: unknown, msg: string): void };
}

export interface ChatSocket {
  send(text: string): void;
  close(code?: number): void;
}

export interface Chat {
  sessionId: string;
  onMessage(raw: string): Promise<void>;
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
  send(await sessionMessage(deps, sessionId, existing !== undefined));

  let busy = false;

  async function runOne(text: string, timings: { speechEnd?: number; sttFinal?: number }) {
    const started = performance.now();
    let firstOutputMs: number | undefined;
    let result: TurnResult;
    try {
      result = await runTurn(deps, { sessionId, text }, (m) => {
        if (firstOutputMs === undefined && FIRST_OUTPUT.has(m.type)) {
          firstOutputMs = performance.now() - started;
        }
        send(m);
      });
    } catch (error) {
      ctx.logger.error({ err: error, sessionId }, "turn failed");
      send({ type: "error", code: "server_error", message: SERVER_ERROR_MESSAGE });
      return;
    }
    await record(ctx, sessionId, text, timings, result, firstOutputMs).catch((error: unknown) =>
      ctx.logger.error({ err: error, sessionId }, "storing the turn failed"),
    );
  }

  return {
    sessionId,
    async onMessage(raw: string) {
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
      if (busy) {
        send({ type: "error", code: "busy", message: "Still answering your last message." });
        return;
      }
      busy = true;
      try {
        await runOne(message.text, message.timings);
      } finally {
        busy = false;
      }
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
  const turnIndex = session?.turn ?? 1;
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
