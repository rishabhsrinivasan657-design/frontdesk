import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { BOOK, DETAILS, memoryDeps } from "../test-deps.js";
import { TestClient } from "../ws-client.js";
import type { ChatContext } from "./connection.js";
import { InMemoryConversationLog } from "./conversation-log.js";
import { SessionHub } from "./hub.js";

const ORIGIN = "http://localhost:3000";
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

/** Fails like Drizzle does: the message ends with the query's parameters (the caller's details). */
class LeakyLog extends InMemoryConversationLog {
  override recordTurn(): Promise<void> {
    return Promise.reject(new Error("insert into turns failed\nparams: Bo Chen,bo@example.com"));
  }
}

describe("logs carry no personal data (M10)", () => {
  it("a full booking, with a storage failure, logs no name, email or session id", async () => {
    const lines: string[] = [];
    const logged: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logged.push(a));
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logged.push(a));
    const chat: ChatContext = {
      deps: memoryDeps(),
      log: new LeakyLog(),
      price: { input: 0, output: 0 },
      newSessionId: () => "sess_private_credential",
      logger: { error: (obj, msg) => console.error(msg, obj) },
      hub: new SessionHub(),
    };
    app = buildServer({
      chat,
      webOrigins: [ORIGIN],
      logger: { stream: { write: (line: string) => void lines.push(line) } },
    });
    const url = (await app.listen({ port: 0, host: "127.0.0.1" })).replace("http", "ws") + "/ws";
    const client = await TestClient.connect(url, { origin: ORIGIN });
    const { sessionId } = await client.next("session");
    await client.turn(BOOK);
    await client.turn(DETAILS);
    await client.next("pending_action");
    await client.turn("Yes, please");
    expect((await client.next("action_result")).status).toBe("executed");
    client.close();
    await client.closed;
    // Reconnect with the id in the URL, as a browser does after a drop.
    const again = await TestClient.connect(`${url}?sessionId=${sessionId}`, { origin: ORIGIN });
    await again.next("session");
    again.close();

    const out = [...lines, ...logged.map((a) => JSON.stringify(a))].join("\n");
    expect(logged.length).toBeGreaterThan(0); // the storage failure was logged
    for (const pii of ["Bo Chen", "bo@example.com", sessionId, "params"]) {
      expect(out).not.toContain(pii);
    }
  });
});
