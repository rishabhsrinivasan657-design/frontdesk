import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ChatContext } from "./chat/connection.js";
import { InMemoryConversationLog } from "./chat/conversation-log.js";
import { SessionHub } from "./chat/hub.js";
import type { ChatGuard, ConnectVerdict, TurnVerdict } from "./abuse/chat-limits.js";
import { type ServerOptions, buildServer } from "./server.js";
import { BOOK, DETAILS, memoryDeps } from "./test-deps.js";
import { TestClient } from "./ws-client.js";

const ORIGIN = "http://localhost:3000";
let app: FastifyInstance | undefined;
const clients: TestClient[] = [];

let n = 0;
async function start(extra: Partial<ServerOptions> = {}) {
  const deps = memoryDeps();
  const chat: ChatContext = {
    deps,
    log: new InMemoryConversationLog(),
    price: { input: 0, output: 0 },
    newSessionId: () => `sess_${++n}`,
    logger: { error: vi.fn() },
    hub: new SessionHub(),
  };
  app = buildServer({ chat, webOrigins: [ORIGIN], logger: false, ...extra });
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  return { deps, url: address.replace("http", "ws") + "/ws", http: address };
}

async function connect(url: string, headers: Record<string, string> = { origin: ORIGIN }) {
  const client = await TestClient.connect(url, headers);
  clients.push(client);
  return client;
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await app?.close();
  app = undefined;
});

describe("api server", () => {
  it("books over a real socket", async () => {
    const { url } = await start();
    const client = await connect(url);
    await client.next("session");
    await client.turn(BOOK);
    await client.turn(DETAILS);
    await client.next("pending_action");
    await client.turn("Yes, please");
    expect((await client.next("action_result")).status).toBe("executed");
  });

  it("refuses an upgrade from a foreign origin", async () => {
    const { url } = await start();
    const client = await connect(url, { origin: "https://evil.example" });
    expect(await client.closed).toBe(1008);
    expect(client.received).toEqual([]);
  });

  it("accepts a client that sends no origin", async () => {
    const { url } = await start();
    const client = await connect(url, {});
    expect((await client.next("session")).resumed).toBe(false);
  });

  it("resumes with ?sessionId after the socket closes", async () => {
    const { url } = await start();
    const first = await connect(url);
    const { sessionId } = await first.next("session");
    await first.turn(BOOK);
    await first.turn(DETAILS);
    const pending = await first.next("pending_action");
    first.close();
    await first.closed;

    const second = await connect(`${url}?sessionId=${encodeURIComponent(sessionId)}`);
    const session = await second.next("session");
    expect(session).toMatchObject({ sessionId, resumed: true });
    expect(session.pending?.actionId).toBe(pending.actionId);
    await second.turn("Yes, please");
    expect((await second.next("action_result")).status).toBe("executed");
  });

  it("a reconnect while the old socket is open replaces it", async () => {
    const { url } = await start();
    const first = await connect(url);
    const { sessionId } = await first.next("session");
    await first.turn(BOOK);
    const second = await connect(`${url}?sessionId=${encodeURIComponent(sessionId)}`);
    expect((await second.next("session")).resumed).toBe(true);
    expect(await first.closed).toBe(4000);
  });

  it("closes the socket on a frame over 16 KiB", async () => {
    const { url } = await start();
    const client = await connect(url);
    await client.next("session");
    client.ws.send("x".repeat(20_000));
    expect(await client.closed).toBe(1009);
  });

  it("never logs the session id from a reconnect URL", async () => {
    const lines: string[] = [];
    const deps = memoryDeps();
    const chat: ChatContext = {
      deps,
      log: new InMemoryConversationLog(),
      price: { input: 0, output: 0 },
      newSessionId: () => `sess_secret_${++n}`,
      logger: { error: vi.fn() },
      hub: new SessionHub(),
    };
    app = buildServer({
      chat,
      webOrigins: [ORIGIN],
      logger: { stream: { write: (line: string) => void lines.push(line) } },
    });
    const url = (await app.listen({ port: 0, host: "127.0.0.1" })).replace("http", "ws") + "/ws";
    const first = await connect(url);
    const { sessionId } = await first.next("session");
    await first.turn(BOOK);
    first.close();
    await first.closed;
    const again = await connect(`${url}?sessionId=${sessionId}`);
    await again.next("session");
    expect(lines.some((l) => l.includes("/ws"))).toBe(true);
    expect(lines.join("\n")).not.toContain(sessionId);
  });

  it("health is ok", async () => {
    const { http } = await start();
    expect(await (await fetch(`${http}/health`)).json()).toEqual({ ok: true });
  });
});

/** Records what the server asked and answers with the given verdicts. */
function spyGuard(o: { connect?: ConnectVerdict; turn?: TurnVerdict } = {}) {
  const seen = { connect: [] as string[], release: [] as string[], turn: [] as string[] };
  const guard: ChatGuard = {
    connect: (ip) => (seen.connect.push(ip), Promise.resolve(o.connect ?? "ok")),
    release: (ip) => void seen.release.push(ip),
    turn: (ip) => (seen.turn.push(ip), Promise.resolve(o.turn ?? "ok")),
  };
  return { guard, seen };
}

describe("chat limits (M10)", () => {
  it("closes with 4429 when connect is refused", async () => {
    const { guard } = spyGuard({ connect: "too_many_sessions" });
    const { url } = await start({ chatGuard: guard });
    const client = await connect(url);
    expect(await client.closed).toBe(4429);
    expect(client.received).toEqual([]);
  });

  it("releases the socket slot when it closes", async () => {
    const { guard, seen } = spyGuard();
    const { url } = await start({ chatGuard: guard });
    const client = await connect(url);
    await client.next("session");
    client.close();
    await client.closed;
    await expect.poll(() => seen.release).toEqual(["127.0.0.1"]);
  });

  it("a refused turn gets an error and runs nothing", async () => {
    const { guard } = spyGuard({ turn: "slow_down" });
    const { url, deps } = await start({ chatGuard: guard });
    const client = await connect(url);
    await client.next("session");
    client.say(BOOK);
    expect(await client.next("error")).toEqual({
      type: "error",
      code: "rate_limited",
      message: "You're sending messages quickly. Please wait a moment.",
    });
    expect(client.received.some((m) => m.type === "turn_metrics")).toBe(false);
    expect(await deps.sessions.load((await client.next("session")).sessionId)).toBeUndefined();
  });

  it.each([
    [
      "session_full",
      "session_full",
      "This chat has reached its limit. Please start a new one or call us.",
    ],
    [
      "daily_limit",
      "rate_limited",
      "We've had a lot of chats from your network today. Please call the restaurant.",
    ],
  ] as const)("%s is told to the caller", async (verdict, code, message) => {
    const { guard } = spyGuard({ turn: verdict });
    const { url } = await start({ chatGuard: guard });
    const client = await connect(url);
    await client.next("session");
    client.say(BOOK);
    expect(await client.next("error")).toEqual({ type: "error", code, message });
  });

  it("ignores X-Forwarded-For from an untrusted peer", async () => {
    const { guard, seen } = spyGuard();
    const { url } = await start({ chatGuard: guard, trustProxy: ["10.0.0.0/8"] });
    const client = await connect(url, { origin: ORIGIN, "x-forwarded-for": "1.2.3.4" });
    await client.next("session");
    client.say(BOOK);
    await client.next("turn_metrics");
    expect(seen.connect).toEqual(["127.0.0.1"]);
    expect(seen.turn).toEqual(["127.0.0.1"]);
  });

  it("uses X-Forwarded-For from a trusted proxy", async () => {
    const { guard, seen } = spyGuard();
    const { url } = await start({ chatGuard: guard });
    const client = await connect(url, { origin: ORIGIN, "x-forwarded-for": "1.2.3.4" });
    await client.next("session");
    expect(seen.connect).toEqual(["1.2.3.4"]);
  });
});
