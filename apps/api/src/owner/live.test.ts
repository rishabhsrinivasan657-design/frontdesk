import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatContext } from "../chat/connection.js";
import { InMemoryConversationLog } from "../chat/conversation-log.js";
import { SessionHub } from "../chat/hub.js";
import { buildServer } from "../server.js";
import { BOOK, DETAILS, memoryDeps } from "../test-deps.js";
import { TestClient } from "../ws-client.js";
import { OwnerFeed } from "./feed.js";
import { ownerLiveRoutes } from "./live.js";
import { testOwner } from "./test-owner.js";

const EMAIL = "owner@casafiorella.test";
const PASSWORD = "correct horse battery staple";
let app: FastifyInstance | undefined;
const clients: TestClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await app?.close();
  app = undefined;
});

async function start() {
  const deps = memoryDeps();
  const feed = new OwnerFeed();
  const hub = new SessionHub();
  let n = 0;
  const chat: ChatContext = {
    deps,
    log: new InMemoryConversationLog(),
    price: { input: 0, output: 0 },
    newSessionId: () => `sess_${++n}`,
    logger: { error: vi.fn() },
    hub,
    feed,
  };
  app = buildServer({
    chat,
    webOrigins: [],
    logger: false,
    owner: testOwner({ email: EMAIL, passwordHash: bcrypt.hashSync(PASSWORD, 4) }),
    ownerRoutes: [ownerLiveRoutes({ hub, sessions: deps.sessions, clock: deps.clock, feed })],
  });
  const http = await app.listen({ port: 0, host: "127.0.0.1" });
  const res = await app.inject({
    method: "POST",
    url: "/owner/login",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
  const connect = async () => {
    const c = await TestClient.connect(http.replace("http", "ws") + "/ws");
    clients.push(c);
    return c;
  };
  return { http, cookie, connect };
}

/** Reads SSE frames until `until` matches one, or times out. */
async function readEvents(body: ReadableStream<Uint8Array>, until: (frame: string) => boolean) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: string[] = [];
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf("\n\n")) !== -1) {
      frames.push(buffer.slice(0, i));
      buffer = buffer.slice(i + 2);
    }
    if (frames.some(until)) break;
  }
  await reader.cancel();
  return frames;
}

describe("owner live feed", () => {
  it("lists active sessions with their pending read-back", async () => {
    const { http, cookie, connect } = await start();
    const caller = await connect();
    const { sessionId } = await caller.next("session");
    await caller.turn(BOOK);
    await caller.turn(DETAILS);
    await caller.next("pending_action");
    const live = (await (await fetch(`${http}/owner/live`, { headers: { cookie } })).json()) as {
      sessionId: string;
      turnCount: number;
      lastCallerText: string;
      pending: { summary: string } | null;
    }[];
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ sessionId, turnCount: 2, lastCallerText: DETAILS });
    expect(live[0]!.pending?.summary).toContain("4");
  });

  it("live stream requires the cookie and delivers a turn event", async () => {
    const { http, cookie, connect } = await start();
    expect((await fetch(`${http}/owner/live/stream`)).status).toBe(401);
    const res = await fetch(`${http}/owner/live/stream`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    const frames = readEvents(res.body!, (f) => f.startsWith("event: turn"));
    const caller = await connect();
    await caller.next("session");
    await caller.turn(BOOK);
    const got = await frames;
    const turn = got.find((f) => f.startsWith("event: turn"))!;
    expect(turn).toBeDefined();
    const data = JSON.parse(
      turn
        .split("\n")
        .find((l) => l.startsWith("data: "))!
        .slice(6),
    ) as {
      callerText: string;
    };
    expect(data.callerText).toBe(BOOK);
    expect(got.some((f) => f.startsWith("event: session_open"))).toBe(true);
  });
});
