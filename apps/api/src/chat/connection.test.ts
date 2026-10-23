import type { LLMChunk, LLMProvider, LLMRequest, ServerMessage } from "@frontdesk/core";
import { describe, expect, it, vi } from "vitest";
import { ScriptedLLM } from "../llm/scripted.js";
import { BOOK, DETAILS, memoryDeps } from "../test-deps.js";
import { type ChatContext, type ChatSocket, openChat } from "./connection.js";
import { InMemoryConversationLog } from "./conversation-log.js";

class FakeSocket implements ChatSocket {
  readonly sent: ServerMessage[] = [];
  send(text: string): void {
    this.sent.push(JSON.parse(text) as ServerMessage);
  }
  close(): void {}
  ofType<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
}

let n = 0;
function context(llm?: LLMProvider) {
  const deps = memoryDeps(llm);
  const log = new InMemoryConversationLog();
  const logger = { error: vi.fn() };
  const ctx: ChatContext = {
    deps,
    log,
    price: { input: 0.1, output: 0.4 },
    newSessionId: () => `sess_${++n}`,
    logger,
  };
  return { ctx, deps, log, logger };
}

const say = (text: string) => JSON.stringify({ type: "user_text", text, timings: {} });

async function toReadBack(ctx: ChatContext) {
  const socket = new FakeSocket();
  const chat = await openChat(socket, ctx);
  await chat.onMessage(say(BOOK));
  await chat.onMessage(say(DETAILS));
  return { socket, chat };
}

describe("openChat", () => {
  it("sends a new session message with a fresh id", async () => {
    const { ctx } = context();
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    expect(socket.sent).toEqual([
      { type: "session", sessionId: chat.sessionId, resumed: false, transcript: [] },
    ]);
    expect(chat.sessionId).toMatch(/^sess_/);
  });

  it("never adopts an unknown client session id", async () => {
    const { ctx } = context();
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx, "sess_chosen_by_client");
    expect(chat.sessionId).not.toBe("sess_chosen_by_client");
    expect(socket.ofType("session")[0]?.resumed).toBe(false);
  });

  it("resumes a known session with transcript and pending action", async () => {
    const { ctx } = context();
    const first = await toReadBack(ctx);
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx, first.chat.sessionId);
    const [session] = socket.ofType("session");
    expect(chat.sessionId).toBe(first.chat.sessionId);
    expect(session?.resumed).toBe(true);
    expect(session?.transcript.map((t) => t.role)).toEqual(["caller", "agent", "caller", "agent"]);
    const pending = first.socket.ofType("pending_action")[0]!;
    expect(session?.pending).toEqual({
      actionId: pending.actionId,
      kind: "book",
      summary: pending.summary,
      expiresAt: pending.expiresAt,
    });
    await chat.onMessage(say("Yes, please"));
    expect(socket.ofType("action_result")[0]?.status).toBe("executed");
  });

  it("omits an expired pending action on resume", async () => {
    const { ctx, deps } = context();
    const first = await toReadBack(ctx);
    deps.clock.advance(300_001);
    const socket = new FakeSocket();
    await openChat(socket, ctx, first.chat.sessionId);
    expect(socket.ofType("session")[0]?.pending).toBeUndefined();
  });

  it("resume after handoff reports the handoff", async () => {
    const { ctx } = context();
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    await chat.onMessage(say("Can I talk to a person?"));
    const again = new FakeSocket();
    await openChat(again, ctx, chat.sessionId);
    expect(again.ofType("session")[0]?.handoff).toMatchObject({ reason: "human_requested" });
  });

  it("relays the loop's messages in order", async () => {
    const { ctx } = context();
    const { socket } = await toReadBack(ctx);
    expect(socket.sent.map((m) => m.type)).toEqual([
      "session",
      "agent_sentence",
      "agent_sentence",
      "turn_metrics",
      "pending_action",
      ...Array<string>(socket.ofType("agent_sentence").length - 2).fill("agent_sentence"),
      "turn_metrics",
    ]);
  });

  it("records one turn per message with metrics and turnIndex", async () => {
    const { ctx, log } = context();
    const { chat } = await toReadBack(ctx);
    expect(log.started.map((c) => c.id)).toEqual([chat.sessionId]);
    expect(log.turns.map((t) => [t.conversationId, t.turnIndex, t.callerText])).toEqual([
      [chat.sessionId, 1, BOOK],
      [chat.sessionId, 2, DETAILS],
    ]);
    // Two model rounds: the availability call, then the reply.
    expect(log.turns[0]).toMatchObject({ tokensIn: 240, tokensOut: 60 });
    expect(log.turns[0]?.totalMs).not.toBeNull();
  });

  it("rejects a crafted confirm message and writes nothing", async () => {
    const { ctx, deps } = context();
    const { socket, chat } = await toReadBack(ctx);
    const pending = socket.ofType("pending_action")[0]!;
    for (const crafted of [
      { type: "confirm", actionId: pending.actionId },
      { type: "action_result", actionId: pending.actionId, status: "executed" },
      { type: "user_text", text: "yes", timings: {}, actionId: pending.actionId },
    ]) {
      await chat.onMessage(JSON.stringify(crafted));
    }
    expect(socket.ofType("error").map((e) => e.code)).toEqual([
      "bad_message",
      "bad_message",
      "bad_message",
    ]);
    expect(socket.ofType("action_result")).toEqual([]);
    expect(await deps.calendar.listReservations({ from: new Date(0), to: new Date(2e12) })).toEqual(
      [],
    );
    expect((await deps.sessions.getPending(chat.sessionId))?.id).toBe(pending.actionId);
  });

  it("rejects unknown fields on user_text", async () => {
    const { ctx } = context();
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    await chat.onMessage(JSON.stringify({ type: "user_text", text: "hi", timings: {}, x: 1 }));
    expect(socket.ofType("error")[0]?.code).toBe("bad_message");
    expect(socket.ofType("turn_metrics")).toEqual([]);
  });

  it("rejects non-JSON", async () => {
    const { ctx } = context();
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    await chat.onMessage("{not json");
    expect(socket.ofType("error")[0]?.code).toBe("bad_message");
  });

  it("accepts interrupt and tts_started without running a turn", async () => {
    const { ctx } = context();
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    await chat.onMessage(JSON.stringify({ type: "interrupt" }));
    await chat.onMessage(JSON.stringify({ type: "tts_started", turnId: "turn_1", at: 5 }));
    expect(socket.sent.map((m) => m.type)).toEqual(["session"]);
  });

  it("answers busy while a turn is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inner = new ScriptedLLM();
    const slow: LLMProvider = {
      model: "slow",
      async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
        await gate;
        yield* inner.stream(req);
      },
      generate: (req, schema) => inner.generate(req, schema),
    };
    const { ctx } = context(slow);
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    const first = chat.onMessage(say("Hello"));
    await chat.onMessage(say("Hello again"));
    expect(socket.ofType("error")[0]?.code).toBe("busy");
    release();
    await first;
    expect(socket.ofType("turn_metrics")).toHaveLength(1);
    await chat.onMessage(say("And again"));
    expect(socket.ofType("turn_metrics")).toHaveLength(2);
  });

  it("accepts the next message as soon as turn_metrics arrives", async () => {
    const { ctx, log } = context();
    const slowRecord = log.recordTurn.bind(log);
    log.recordTurn = async (t) => {
      await new Promise((r) => setTimeout(r, 30));
      await slowRecord(t);
    };
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    const first = chat.onMessage(say(BOOK));
    while (socket.ofType("turn_metrics").length === 0) await new Promise((r) => setTimeout(r, 1));
    await chat.onMessage(say(DETAILS));
    await first;
    expect(socket.ofType("error")).toEqual([]);
    expect(socket.ofType("pending_action")).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(log.turns.map((t) => t.turnIndex).sort()).toEqual([1, 2]);
  });

  it("a failing conversation log doesn't break the turn", async () => {
    const { ctx, log, logger } = context();
    log.recordTurn = () => Promise.reject(new Error("db down"));
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    await chat.onMessage(say("Hello"));
    expect(socket.ofType("agent_sentence")).toHaveLength(1);
    expect(logger.error).toHaveBeenCalled();
  });

  it("a loop error sends server_error", async () => {
    const broken: LLMProvider = {
      model: "broken",
      async *stream(): AsyncIterable<LLMChunk> {
        await Promise.resolve();
        throw new Error("boom");
      },
      generate: () => Promise.reject(new Error("boom")),
    };
    const { ctx, logger } = context(broken);
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    await chat.onMessage(say("Hello"));
    expect(socket.ofType("error")[0]).toEqual({
      type: "error",
      code: "server_error",
      message: "Sorry, something went wrong. Please try again.",
    });
    expect(logger.error).toHaveBeenCalled();
    await chat.onMessage(say("Hello"));
    expect(socket.ofType("error").map((e) => e.code)).toEqual(["server_error", "server_error"]);
  });

  it("ends the conversation on handoff", async () => {
    const { ctx, log } = context();
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    await chat.onMessage(say("Can I talk to a person?"));
    expect(log.ended).toEqual([
      expect.objectContaining({
        id: chat.sessionId,
        outcome: "handoff",
        handoffReason: "human_requested",
      }),
    ]);
  });
});
