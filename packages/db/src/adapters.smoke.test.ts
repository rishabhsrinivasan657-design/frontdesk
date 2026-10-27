import { randomUUID } from "node:crypto";
import type { AuditEvent, HandoffTicket } from "@frontdesk/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgAuditLog } from "./audit-log.js";
import { createDb } from "./client.js";
import { PgConversations, type TurnRecord } from "./conversations.js";
import { PgHandoffQueue } from "./handoff-queue.js";
import { migrate } from "./migrate.js";
import { TEST_DATABASES } from "./test-db.js";

const conn = createDb(TEST_DATABASES.live);
beforeAll(() => migrate(TEST_DATABASES.live));
afterAll(() => conn.close());

const id = (prefix: string) => `${prefix}_${randomUUID()}`;

describe("PgAuditLog", () => {
  const audit = new PgAuditLog(conn.db);

  it("round-trips AuditEvents in order", async () => {
    const actionId = id("act");
    const args = {
      kind: "book",
      slotId: "slot_1",
      name: "Ana Ruiz",
      contact: "ana@example.com",
      partySize: 4,
      notes: "",
    } as const;
    const proposed: AuditEvent = {
      at: "2026-11-06T23:00:00.000Z",
      sessionId: "s1",
      turnId: "turn_1",
      actionId,
      kind: "book",
      stage: "proposed",
      args,
    };
    const executed: AuditEvent = {
      ...proposed,
      at: "2026-11-06T23:00:05.000Z",
      turnId: "turn_2",
      stage: "executed",
      result: { id: "res_1", start: "2026-11-07T00:00:00.000Z" },
    };
    await audit.append(proposed);
    await audit.append(executed);
    const rows = await audit.forAction(actionId);
    expect(rows.map((r) => r.stage)).toEqual(["proposed", "executed"]);
    expect(rows[0]).toMatchObject({ at: proposed.at, turnId: "turn_1", args });
    expect(rows[1]).toMatchObject({ result: executed.result });
  });

  it("records email attempts as email_failed / email_sent", async () => {
    const actionId = id("act");
    const base = { sessionId: "s1", actionId, kind: "book" as const };
    await audit.recordEmailAttempt({
      ...base,
      at: "2026-11-06T23:01:00.000Z",
      ok: false,
      attempt: 1,
      error: "smtp 503",
    });
    await audit.recordEmailAttempt({
      ...base,
      at: "2026-11-06T23:01:02.000Z",
      ok: true,
      attempt: 2,
    });
    const rows = await audit.forAction(actionId);
    expect(rows.map((r) => [r.stage, r.result, r.reason])).toEqual([
      ["email_failed", { attempt: 1 }, "smtp 503"],
      ["email_sent", { attempt: 2 }, null],
    ]);
  });
});

describe("PgHandoffQueue", () => {
  it("enqueues and lists open tickets with their transcript", async () => {
    const queue = new PgHandoffQueue(conn.db);
    const ticket: HandoffTicket = {
      id: id("handoff"),
      sessionId: "s1",
      reason: "email_failed",
      summary: "Confirmation email failed after 5 attempts.",
      transcript: [{ role: "caller", text: "Book a table", turnId: "turn_1" }],
      createdAt: "2026-11-06T23:02:00.000Z",
    };
    await queue.enqueue(ticket);
    const open = await queue.open();
    expect(open.find((t) => t.id === ticket.id)).toEqual(ticket);
  });

  it("ignores a second enqueue of the same ticket id", async () => {
    const queue = new PgHandoffQueue(conn.db);
    const ticket: HandoffTicket = {
      id: id("handoff"),
      sessionId: "s1",
      reason: "email_failed",
      summary: "first",
      transcript: [],
      createdAt: "2026-11-06T23:02:00.000Z",
    };
    await queue.enqueue(ticket);
    await queue.enqueue({ ...ticket, summary: "second" });
    const mine = (await queue.open()).filter((t) => t.id === ticket.id);
    expect(mine.map((t) => t.summary)).toEqual(["first"]);
  });
});

describe("PgConversations", () => {
  const conversations = new PgConversations(conn.db);
  const turn = (conversationId: string): TurnRecord => ({
    id: id("turn"),
    conversationId,
    turnIndex: 1,
    callerText: "Table for 4 Saturday?",
    agentText: "Saturday at 7:00 PM is open.",
    sttMs: 310,
    llmTtftMs: 640,
    llmTotalMs: 1200,
    toolMs: [12, 40],
    ttsStartMs: 90,
    firstOutputMs: 700,
    toolCalls: [
      { name: "check_availability", ms: 12, ok: true },
      { name: "lookup_faq", ms: 40, ok: true },
    ],
    totalMs: 1650,
    tokensIn: 900,
    tokensOut: 60,
    costUsd: 0.000123,
    flags: [],
    createdAt: "2026-11-06T23:03:00.000Z",
  });

  it("start is idempotent", async () => {
    const conversationId = id("s");
    const c = {
      id: conversationId,
      source: "live" as const,
      startedAt: "2026-11-06T23:00:00.000Z",
    };
    await conversations.start(c);
    await conversations.start({ ...c, startedAt: "2026-11-06T23:05:00.000Z" });
    await conversations.recordTurn(turn(conversationId));
    expect(await conversations.turns(conversationId)).toHaveLength(1);
  });

  it("setTtsStart fills tts_start_ms and appends flags only while it is null", async () => {
    const conversationId = id("s");
    await conversations.start({
      id: conversationId,
      source: "live",
      startedAt: "2026-11-06T23:02:59.000Z",
    });
    const t = { ...turn(conversationId), ttsStartMs: null, flags: ["injection_pattern"] };
    await conversations.recordTurn(t);
    await conversations.setTtsStart(conversationId, t.id, 420, ["over_p95_tts_start"]);
    await conversations.setTtsStart(conversationId, t.id, 99, ["second"]);
    await conversations.setTtsStart(id("s"), t.id, 1, ["other_conversation"]);
    const [row] = await conversations.turns(conversationId);
    expect(row).toMatchObject({
      ttsStartMs: 420,
      flags: ["injection_pattern", "over_p95_tts_start"],
    });
  });

  it("stores a turn with every metric and reads it back", async () => {
    const conversationId = id("s");
    await conversations.start({
      id: conversationId,
      source: "live",
      startedAt: "2026-11-06T23:02:59.000Z",
    });
    const t = turn(conversationId);
    await conversations.recordTurn(t);
    await conversations.end(conversationId, {
      endedAt: "2026-11-06T23:05:00.000Z",
      outcome: "booked",
    });
    expect(await conversations.turns(conversationId)).toEqual([t]);
  });

  const fb = (conversationId: string) => ({
    id: id("fb"),
    conversationId,
    rating: 5,
    comment: "Easy!",
    createdAt: "2026-11-06T23:06:00.000Z",
  });

  it("saves one feedback per conversation", async () => {
    const conversationId = id("s");
    await conversations.start({
      id: conversationId,
      source: "pilot",
      startedAt: "2026-11-06T23:00:00.000Z",
    });
    expect(await conversations.saveFeedback(fb(conversationId))).toBe("saved");
    expect(await conversations.saveFeedback({ ...fb(conversationId), rating: 1 })).toBe(
      "duplicate",
    );
    const rows = await conn.db.execute<{ rating: number }>(
      sql`select rating from feedback where conversation_id = ${conversationId}`,
    );
    expect(rows.rows.map((r) => r.rating)).toEqual([5]);
  });

  it("refuses feedback for a conversation that doesn't exist", async () => {
    expect(await conversations.saveFeedback(fb(id("s")))).toBe("no_conversation");
  });

  it("rejects an unknown source", async () => {
    await expect(
      conversations.start({
        id: id("s"),
        source: "test" as "live",
        startedAt: "2026-11-06T23:00:00.000Z",
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate turn index", async () => {
    const conversationId = id("s");
    await conversations.start({
      id: conversationId,
      source: "eval",
      startedAt: "2026-11-06T23:00:00.000Z",
    });
    await conversations.recordTurn(turn(conversationId));
    await expect(conversations.recordTurn(turn(conversationId))).rejects.toThrow();
  });
});
