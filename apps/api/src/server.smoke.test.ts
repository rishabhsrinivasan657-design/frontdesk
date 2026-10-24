import { randomUUID } from "node:crypto";
import { createConfirmationQueue } from "@frontdesk/worker";
import { createDb, migrate, schema } from "@frontdesk/db";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDeps } from "./deps.js";
import { buildServer } from "./server.js";
import { BOOK, DETAILS, TEST_NOW } from "./test-deps.js";
import { TestClient } from "./ws-client.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://frontdesk:frontdesk@localhost:54320/frontdesk";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:63790";
const QUEUE_PREFIX = `test-${randomUUID()}`;

const env = {
  DATABASE_URL,
  REDIS_URL,
  QUEUE_PREFIX,
  LLM_PROVIDER: "scripted",
  FRONTDESK_NOW: TEST_NOW.toISOString(),
};

const pg = createDb(DATABASE_URL);
const queue = createConfirmationQueue(REDIS_URL, QUEUE_PREFIX);
let app: FastifyInstance;
let close: () => Promise<void>;
let url: string;

beforeAll(async () => {
  await migrate(DATABASE_URL);
  const built = await buildDeps(env);
  close = () => built.close();
  app = buildServer({ chat: built.chat, webOrigins: [], logger: false });
  url = (await app.listen({ port: 0, host: "127.0.0.1" })).replace("http", "ws") + "/ws";
});

afterAll(async () => {
  await app.close();
  await close();
  await queue.obliterate({ force: true });
  await queue.close();
  await pg.close();
});

async function readBack() {
  const client = await TestClient.connect(url);
  const { sessionId } = await client.next("session");
  await client.turn(BOOK);
  await client.turn(DETAILS);
  const pending = await client.next("pending_action");
  return { client, sessionId, pending };
}

describe("api against Redis and Postgres", () => {
  it("confirms after reconnecting, stores turns, audits and enqueues the email", async () => {
    const { client, sessionId, pending } = await readBack();
    client.close();
    await client.closed;

    const again = await TestClient.connect(`${url}?sessionId=${sessionId}`);
    expect((await again.next("session")).pending?.actionId).toBe(pending.actionId);
    await again.turn("Yes, please");
    expect((await again.next("action_result")).status).toBe("executed");
    again.close();

    const turns = await pg.db
      .select()
      .from(schema.turns)
      .where(eq(schema.turns.conversationId, sessionId));
    expect(turns.map((t) => t.turnIndex).sort()).toEqual([1, 2, 3]);
    expect(turns.every((t) => t.totalMs !== null && t.costUsd === 0)).toBe(true);
    const [conversation] = await pg.db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, sessionId));
    expect(conversation?.source).toBe("live");

    const stages = await pg.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actionId, pending.actionId))
      .orderBy(asc(schema.auditLog.seq));
    expect(stages.map((s) => s.stage)).toEqual(["proposed", "confirmed", "executed"]);

    const job = await queue.getJob(`confirm-${pending.actionId}`);
    expect(job?.data.email.to).toBe("bo@example.com");
  });

  it("confirms after reconnecting when the api clock is far from real time", async () => {
    const past = await buildDeps({ ...env, FRONTDESK_NOW: "2020-01-08T14:00:00-05:00" });
    const server = buildServer({ chat: past.chat, webOrigins: [], logger: false });
    const pastUrl =
      (await server.listen({ port: 0, host: "127.0.0.1" })).replace("http", "ws") + "/ws";
    try {
      const first = await TestClient.connect(pastUrl);
      const { sessionId } = await first.next("session");
      // 2020-01-08 is a Wednesday; Saturday the 11th at 19:00 is open.
      await first.turn("A table for 4 on 2020-01-11 at 19:00");
      await first.turn(DETAILS);
      const pending = await first.next("pending_action");
      first.close();
      await first.closed;
      const again = await TestClient.connect(`${pastUrl}?sessionId=${sessionId}`);
      expect((await again.next("session")).pending?.actionId).toBe(pending.actionId);
      await again.turn("Yes, please");
      expect((await again.next("action_result")).status).toBe("executed");
      again.close();
    } finally {
      await server.close();
      await past.close();
    }
  });

  it("handoff writes a handoffs row and ends the conversation", async () => {
    const client = await TestClient.connect(url);
    const { sessionId } = await client.next("session");
    await client.turn("Can I talk to a person?");
    expect((await client.next("handoff")).reason).toBe("human_requested");
    client.close();
    const rows = await pg.db
      .select()
      .from(schema.handoffs)
      .where(eq(schema.handoffs.sessionId, sessionId));
    expect(rows).toHaveLength(1);
    const [conversation] = await pg.db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, sessionId));
    expect(conversation).toMatchObject({ outcome: "handoff", handoffReason: "human_requested" });
  });
});
