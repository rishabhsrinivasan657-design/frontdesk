import type { ServerMessage } from "@frontdesk/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatEvent } from "./state";
import { SESSION_KEY, connectChat } from "./socket";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(m: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const latest = () => FakeWebSocket.instances.at(-1)!;
const session = (sessionId: string): ServerMessage => ({
  type: "session",
  sessionId,
  resumed: false,
  transcript: [],
});

function setup(stored?: string, botToken?: () => Promise<string>) {
  const items = new Map<string, string>(stored ? [[SESSION_KEY, stored]] : []);
  const storage = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
  const events: ChatEvent[] = [];
  const chat = connectChat({
    url: "ws://api/ws",
    storage,
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    onEvent: (e) => events.push(e),
    now: () => 0,
    ...(botToken ? { botToken } : {}),
  });
  return { chat, items, events };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("connectChat", () => {
  it("stores the issued session id", () => {
    const { items } = setup();
    expect(latest().url).toBe("ws://api/ws");
    latest().open();
    latest().receive(session("sess_1"));
    expect(items.get(SESSION_KEY)).toBe("sess_1");
  });

  it("resumes a stored session id on first connect", () => {
    setup("sess_7");
    expect(latest().url).toBe("ws://api/ws?sessionId=sess_7");
  });

  it("reconnects with ?sessionId after an unexpected close", () => {
    const { events } = setup();
    latest().open();
    latest().receive(session("sess_1"));
    latest().drop();
    expect(events.at(-1)).toEqual({ type: "socket", status: "reconnecting" });
    vi.advanceTimersByTime(250);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(latest().url).toBe("ws://api/ws?sessionId=sess_1");
  });

  it("backs off between attempts and resets after a session message", () => {
    setup();
    latest().drop();
    vi.advanceTimersByTime(250);
    latest().drop();
    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
    latest().open();
    latest().receive(session("sess_1"));
    latest().drop();
    vi.advanceTimersByTime(250);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it("caps the backoff at 4 s", () => {
    setup();
    for (let i = 0; i < 8; i++) {
      latest().drop();
      vi.advanceTimersByTime(4000);
    }
    expect(FakeWebSocket.instances).toHaveLength(9);
  });

  it("stops when another tab takes over the session", () => {
    const { events } = setup();
    latest().open();
    latest().receive(session("sess_1"));
    latest().drop(4000);
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "socket", status: "replaced" });
  });

  it.each([
    [4429, "limited"],
    [4403, "bot_check_failed"],
  ] as const)("stops on close code %i without reconnecting", (code, status) => {
    const { events } = setup();
    latest().open();
    latest().drop(code);
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "socket", status });
  });

  it("a new session waits for a bot token and sends it as ts", async () => {
    let give!: (t: string) => void;
    setup(undefined, () => new Promise((r) => (give = r)));
    expect(FakeWebSocket.instances).toHaveLength(0);
    give("tok en");
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    expect(latest().url).toBe("ws://api/ws?ts=tok%20en");
  });

  it("a stored session reconnects without asking for a token", () => {
    const botToken = vi.fn(() => Promise.resolve("t"));
    setup("sess_9", botToken);
    expect(latest().url).toBe("ws://api/ws?sessionId=sess_9");
    expect(botToken).not.toHaveBeenCalled();
  });

  it("4403 forgets the stored session so a reload starts fresh", () => {
    const { items } = setup("sess_9");
    latest().drop(4403);
    expect(items.has(SESSION_KEY)).toBe(false);
  });

  it("doesn't reconnect after close()", () => {
    const { chat } = setup();
    latest().open();
    chat.close();
    latest().drop(1000);
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("sends only caller text, and only while open", () => {
    const { chat } = setup();
    expect(chat.sendText("hi")).toBe(false);
    latest().open();
    expect(chat.sendText("Yes, please")).toBe(true);
    expect(latest().sent.map((s) => JSON.parse(s) as unknown)).toEqual([
      { type: "user_text", text: "Yes, please", timings: {} },
    ]);
  });

  it("sendText carries voice timings", () => {
    const { chat } = setup();
    latest().open();
    chat.sendText("a table for 4", { speechEnd: 1000, sttFinal: 1300 });
    expect(JSON.parse(latest().sent[0]!)).toEqual({
      type: "user_text",
      text: "a table for 4",
      timings: { speechEnd: 1000, sttFinal: 1300 },
    });
  });

  it("sendFeedback sends the rating and comment, only while open", () => {
    const { chat } = setup();
    expect(chat.sendFeedback(4, "Nice")).toBe(false);
    latest().open();
    expect(chat.sendFeedback(4, "Nice")).toBe(true);
    expect(latest().sent.map((m) => JSON.parse(m) as unknown)).toEqual([
      { type: "feedback", rating: 4, comment: "Nice" },
    ]);
  });

  it("sendInterrupt and sendTtsStarted send their messages, only while open", () => {
    const { chat } = setup();
    expect(chat.sendInterrupt()).toBe(false);
    latest().open();
    expect(chat.sendInterrupt()).toBe(true);
    expect(chat.sendTtsStarted("turn_1", 1730000000000)).toBe(true);
    expect(latest().sent.map((m) => JSON.parse(m) as unknown)).toEqual([
      { type: "interrupt" },
      { type: "tts_started", turnId: "turn_1", at: 1730000000000 },
    ]);
  });

  it("passes server messages on with a timestamp", () => {
    const { events } = setup();
    latest().open();
    latest().receive({ type: "agent_sentence", turnId: "t", text: "Hi." });
    expect(events).toContainEqual({
      type: "server",
      message: { type: "agent_sentence", turnId: "t", text: "Hi." },
      at: 0,
    });
  });
});
