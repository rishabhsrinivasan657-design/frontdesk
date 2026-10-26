import type { LLMChunk, LLMProvider, LLMRequest, ServerMessage } from "@frontdesk/core";
import { describe, expect, it, vi } from "vitest";
import { ScriptedLLM } from "../llm/scripted.js";
import { BOOK, DETAILS, memoryDeps } from "../test-deps.js";
import { type ChatContext, type ChatSocket, openChat } from "./connection.js";
import { InMemoryConversationLog } from "./conversation-log.js";
import { SessionHub } from "./hub.js";
import { type LiveEvent, OwnerFeed } from "../owner/feed.js";

class FakeSocket implements ChatSocket {
  readonly sent: ServerMessage[] = [];
  closedWith: number | undefined;
  send(text: string): void {
    if (this.closedWith === undefined) this.sent.push(JSON.parse(text) as ServerMessage);
  }
  close(code?: number): void {
    this.closedWith = code ?? 1000;
  }
  ofType<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
}

/** ScriptedLLM whose turn streams wait until `release()` (or `hold()` again). */
function gatedLLM() {
  let open = true;
  let release!: () => void;
  let gate = Promise.resolve();
  const inner = new ScriptedLLM();
  const llm: LLMProvider = {
    model: "gated",
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      if (!open) await gate;
      yield* inner.stream(req);
    },
    generate: (req, schema) => inner.generate(req, schema),
  };
  const hold = () => {
    open = false;
    gate = new Promise<void>((r) => (release = () => ((open = true), r())));
  };
  hold();
  return { llm, hold, release: () => release(), openNow: () => release() };
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
    hub: new SessionHub(),
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
  it("publishes session, turn, pending and handoff events to the owner feed", async () => {
    const { ctx } = context();
    const feed = new OwnerFeed();
    const events: LiveEvent[] = [];
    feed.subscribe((e) => events.push(e));
    ctx.feed = feed;
    const { chat } = await toReadBack(ctx);
    expect(events.map((e) => e.type)).toEqual(["session_open", "turn", "pending", "turn"]);
    expect(events[1]).toMatchObject({ type: "turn", sessionId: chat.sessionId, callerText: BOOK });
    expect(events[2]).toMatchObject({ type: "pending", sessionId: chat.sessionId });
    await chat.onMessage(say("Yes, please"));
    expect(events.slice(4).map((e) => e.type)).toEqual(["pending_cleared", "turn"]);
    expect(events[4]).toMatchObject({ status: "executed" });
    chat.close();
    expect(events.at(-1)).toMatchObject({ type: "session_closed", sessionId: chat.sessionId });
  });

  it("a replaced socket closing doesn't report the session closed", async () => {
    const { ctx } = context();
    const feed = new OwnerFeed();
    const events: LiveEvent[] = [];
    feed.subscribe((e) => events.push(e));
    ctx.feed = feed;
    const first = await openChat(new FakeSocket(), ctx);
    await first.onMessage(say("what are your hours?"));
    const second = await openChat(new FakeSocket(), ctx, first.sessionId);
    expect(second.sessionId).toBe(first.sessionId);
    first.close();
    expect(events.map((e) => e.type)).not.toContain("session_closed");
    expect(ctx.hub.activeSessions()).toEqual([first.sessionId]);
  });

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

  it("stores conversations as live by default", async () => {
    const { ctx, log } = context();
    await toReadBack(ctx);
    expect(log.started.map((c) => c.source)).toEqual(["live"]);
  });

  it("stores the conversation under the configured source", async () => {
    const { ctx, log } = context();
    ctx.source = "pilot";
    await toReadBack(ctx);
    expect(log.started.map((c) => c.source)).toEqual(["pilot"]);
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

  it("interrupt cancels the in-flight turn", async () => {
    const { llm: slow, release } = gatedLLM();
    const { ctx, log, logger } = context(slow);
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    const first = chat.onMessage(say(BOOK));
    await chat.onMessage(JSON.stringify({ type: "interrupt" }));
    release();
    await first;
    expect(socket.sent.map((m) => m.type)).toEqual(["session", "interrupted"]);
    expect(log.turns).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("interrupt with nothing in flight sends nothing", async () => {
    const { ctx } = context();
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    await chat.onMessage(JSON.stringify({ type: "interrupt" }));
    expect(socket.sent.map((m) => m.type)).toEqual(["session"]);
  });

  it("interrupt during a confirm turn still reports executed", async () => {
    const { ctx, deps } = context();
    const { socket, chat } = await toReadBack(ctx);
    const yes = chat.onMessage(say("Yes, please"));
    await chat.onMessage(JSON.stringify({ type: "interrupt" }));
    await yes;
    expect(socket.ofType("action_result").map((r) => r.status)).toEqual(["executed"]);
    expect(socket.ofType("interrupted")).toEqual([]);
    expect(socket.ofType("turn_metrics")).toHaveLength(3);
    expect(
      await deps.calendar.listReservations({ from: new Date(0), to: new Date(2e12) }),
    ).toHaveLength(1);
  });

  it("user_text after interrupt waits for the cancelled turn", async () => {
    const { llm: slow, release, openNow } = gatedLLM();
    const { ctx } = context(slow);
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    const first = chat.onMessage(say("Hello"));
    await chat.onMessage(JSON.stringify({ type: "interrupt" }));
    const second = chat.onMessage(say("Hello again"));
    release();
    openNow();
    await Promise.all([first, second]);
    expect(socket.ofType("error")).toEqual([]);
    expect(socket.sent.map((m) => m.type)).toEqual([
      "session",
      "interrupted",
      "agent_sentence",
      "turn_metrics",
    ]);
  });

  it("stores tts_start_ms from tts_started, before or after the row is stored", async () => {
    const { ctx, log } = context();
    let t = 1000;
    ctx.monotonicMs = () => t;
    const slowRecord = log.recordTurn.bind(log);
    log.recordTurn = async (row) => {
      await new Promise((r) => setTimeout(r, 20));
      await slowRecord(row);
    };
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    const first = chat.onMessage(say("Hello"));
    while (socket.ofType("agent_sentence").length === 0) await new Promise((r) => setTimeout(r, 1));
    const turn1 = socket.ofType("agent_sentence")[0]!.turnId;
    t = 1120;
    await chat.onMessage(JSON.stringify({ type: "tts_started", turnId: turn1, at: 5 }));
    await first;
    expect(log.turns[0]?.ttsStartMs).toBe(120);

    t = 2000;
    await chat.onMessage(say("Hello again"));
    const turn2 = socket.ofType("agent_sentence").at(-1)!.turnId;
    t = 2400;
    await chat.onMessage(JSON.stringify({ type: "tts_started", turnId: turn2, at: 5 }));
    expect(log.ttsStarts.at(-1)).toEqual({
      conversationId: chat.sessionId,
      turnId: turn2,
      ms: 400,
      flags: ["over_p95_tts_start"],
    });
  });

  it("ignores tts_started for a turn this socket didn't run, and repeats", async () => {
    const { ctx, log } = context();
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    await chat.onMessage(say("Hello"));
    const turnId = socket.ofType("agent_sentence")[0]!.turnId;
    await chat.onMessage(JSON.stringify({ type: "tts_started", turnId: "turn_other", at: 5 }));
    await chat.onMessage(JSON.stringify({ type: "tts_started", turnId, at: 5 }));
    await chat.onMessage(JSON.stringify({ type: "tts_started", turnId, at: 9e12 }));
    expect(log.ttsStarts.map((u) => u.turnId)).toEqual([turnId]);
    expect(socket.ofType("error")).toEqual([]);
  });

  it("answers busy while a turn is in flight", async () => {
    const { llm: slow, release } = gatedLLM();
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

  it("a second socket on the same session closes the first", async () => {
    const { ctx } = context();
    const a = new FakeSocket();
    const chat = await openChat(a, ctx);
    await chat.onMessage(say(BOOK));
    const b = new FakeSocket();
    await openChat(b, ctx, chat.sessionId);
    expect(a.closedWith).toBe(4000);
    expect(b.closedWith).toBeUndefined();
  });

  it("a resume during an in-flight turn waits and includes the pending action", async () => {
    const gated = gatedLLM();
    gated.openNow();
    const { ctx } = context(gated.llm);
    const a = new FakeSocket();
    const chat = await openChat(a, ctx);
    await chat.onMessage(say(BOOK));
    gated.hold();
    const proposing = chat.onMessage(say(DETAILS));
    const b = new FakeSocket();
    const resuming = openChat(b, ctx, chat.sessionId);
    await new Promise((r) => setTimeout(r, 10));
    expect(b.sent).toEqual([]);
    gated.release();
    await proposing;
    await resuming;
    const [session] = b.ofType("session");
    expect(session?.pending?.kind).toBe("book");
    expect(session?.transcript).toHaveLength(4);
  });

  it("the replaced socket's messages are ignored", async () => {
    const { ctx, log } = context();
    const a = new FakeSocket();
    const first = await openChat(a, ctx);
    await first.onMessage(say(BOOK));
    await openChat(new FakeSocket(), ctx, first.sessionId);
    await first.onMessage(say("Hello"));
    expect(log.turns).toHaveLength(1);
  });

  it("error logs carry neither the session id nor query parameters", async () => {
    const { ctx, log, logger } = context();
    log.recordTurn = () =>
      Promise.reject(
        new Error('Failed query: insert into "turns" values ($1)\nparams: Bo Chen,bo@example.com'),
      );
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    await chat.onMessage(say("Hello"));
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).toContain("Failed query");
    expect(logged).not.toContain(chat.sessionId);
    expect(logged).not.toContain("bo@example.com");
  });

  it("a failed conversation start is retried before the next turn is stored", async () => {
    const { ctx, log } = context();
    const start = log.start.bind(log);
    let failures = 1;
    log.start = (c) => (failures-- > 0 ? Promise.reject(new Error("db blip")) : start(c));
    const socket = new FakeSocket();
    const chat = await openChat(socket, ctx);
    await chat.onMessage(say(BOOK));
    await chat.onMessage(say(DETAILS));
    expect(log.started.map((c) => c.id)).toEqual([chat.sessionId]);
    expect(log.turns.map((t) => t.turnIndex)).toEqual([2]);
  });

  it("a resume after the old socket closed mid-turn still waits for that turn", async () => {
    const gated = gatedLLM();
    gated.openNow();
    const { ctx } = context(gated.llm);
    const a = new FakeSocket();
    const chat = await openChat(a, ctx);
    await chat.onMessage(say(BOOK));
    gated.hold();
    const proposing = chat.onMessage(say(DETAILS));
    // A page reload: the old socket closes cleanly before the new one connects.
    chat.close();
    const b = new FakeSocket();
    const resuming = openChat(b, ctx, chat.sessionId);
    await new Promise((r) => setTimeout(r, 10));
    expect(b.sent).toEqual([]);
    gated.release();
    await proposing;
    await resuming;
    expect(b.ofType("session")[0]?.pending?.kind).toBe("book");
  });

  it("a reload during the very first turn keeps the session", async () => {
    const gated = gatedLLM();
    const { ctx } = context(gated.llm);
    const a = new FakeSocket();
    const chat = await openChat(a, ctx);
    const first = chat.onMessage(say(BOOK));
    chat.close();
    const b = new FakeSocket();
    const resuming = openChat(b, ctx, chat.sessionId);
    gated.release();
    await first;
    const resumed = await resuming;
    expect(resumed.sessionId).toBe(chat.sessionId);
    expect(b.ofType("session")[0]?.transcript).toHaveLength(2);
  });

  it("takes the next message the moment turn_metrics is sent, even while saving", async () => {
    const { ctx, deps } = context();
    const save = deps.sessions.save.bind(deps.sessions);
    deps.sessions.save = async (state) => {
      await new Promise((r) => setTimeout(r, 30));
      await save(state);
    };
    let next: Promise<void> | undefined;
    const socket = new FakeSocket();
    const send = socket.send.bind(socket);
    const opened: { chat?: Awaited<ReturnType<typeof openChat>> } = {};
    socket.send = (text: string) => {
      send(text);
      // The browser unlocks on turn_metrics and the caller replies at once.
      if (!next && text.includes('"turn_metrics"')) next = opened.chat?.onMessage(say(DETAILS));
    };
    const chat = await openChat(socket, ctx);
    opened.chat = chat;
    await chat.onMessage(say(BOOK));
    await next;
    expect(socket.ofType("error")).toEqual([]);
    expect(socket.ofType("pending_action")).toHaveLength(1);
  });
});
