import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ChatContext } from "./chat/connection.js";
import { InMemoryConversationLog } from "./chat/conversation-log.js";
import { SessionHub } from "./chat/hub.js";
import { buildServer } from "./server.js";
import { BOOK, DETAILS, memoryDeps } from "./test-deps.js";
import { TestClient } from "./ws-client.js";

const ORIGIN = "http://localhost:3000";
let app: FastifyInstance | undefined;
const clients: TestClient[] = [];

let n = 0;
async function start() {
  const deps = memoryDeps();
  const chat: ChatContext = {
    deps,
    log: new InMemoryConversationLog(),
    price: { input: 0, output: 0 },
    newSessionId: () => `sess_${++n}`,
    logger: { error: vi.fn() },
    hub: new SessionHub(),
  };
  app = buildServer({ chat, webOrigins: [ORIGIN], logger: false });
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

  it("health is ok", async () => {
    const { http } = await start();
    expect(await (await fetch(`${http}/health`)).json()).toEqual({ ok: true });
  });
});
