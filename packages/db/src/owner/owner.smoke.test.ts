import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../client.js";
import { PgHandoffQueue } from "../handoff-queue.js";
import { migrate } from "../migrate.js";
import { auditLog, conversations, handoffs, turns } from "../schema.js";
import { TEST_DATABASES } from "../test-db.js";
import {
  getConversation,
  listBookings,
  listConversations,
  listHandoffs,
  metrics,
} from "./index.js";

const conn = createDb(TEST_DATABASES.live);
const db = conn.db;
beforeAll(() => migrate(TEST_DATABASES.live));
afterAll(() => conn.close());

const TZ = "America/New_York";
const uid = () => randomUUID().slice(0, 8);

/** Inserts a conversation with `n` turns; every caller line carries `tag` so searches stay isolated. */
async function conversation(o: {
  tag: string;
  source?: "live" | "pilot" | "eval";
  seeded?: boolean;
  startedAt: string;
  outcome?: string;
  firstOutputMs?: number[];
  tokens?: [number, number];
  costUsd?: number;
  callerText?: string;
}): Promise<string> {
  const id = `sess_${o.tag}_${uid()}`;
  await db.insert(conversations).values({
    id,
    source: o.source ?? "live",
    seeded: o.seeded ?? false,
    startedAt: o.startedAt,
    outcome: o.outcome ?? null,
    handoffReason: o.outcome === "handoff" ? "caller_request" : null,
  });
  const latencies = o.firstOutputMs ?? [500];
  for (const [i, ms] of latencies.entries()) {
    await db.insert(turns).values({
      id: `turn_${uid()}`,
      conversationId: id,
      turnIndex: i + 1,
      callerText: o.callerText ?? `hello ${o.tag} ${i + 1}`,
      agentText: `reply ${i + 1}`,
      llmTtftMs: ms - 50,
      llmTotalMs: ms + 100,
      toolMs: [ms / 2],
      toolCalls: [{ name: "check_availability", ms: ms / 2, ok: true }],
      firstOutputMs: ms,
      totalMs: ms + 200,
      tokensIn: o.tokens?.[0] ?? 100,
      tokensOut: o.tokens?.[1] ?? 10,
      costUsd: o.costUsd ?? 0.001,
      createdAt: o.startedAt,
    });
  }
  return id;
}

async function audit(
  sessionId: string,
  actionId: string,
  kind: "book" | "reschedule" | "cancel",
  stages: string[],
  result?: unknown,
) {
  for (const stage of stages) {
    await db.insert(auditLog).values({
      at: "2031-03-01T18:00:00.000Z",
      sessionId,
      turnId: null,
      actionId,
      kind,
      stage,
      args: { kind },
      result: stage === "executed" ? result : null,
      reason: null,
    });
  }
}

const booking = (id: string, start: string) => ({
  id,
  start,
  end: start,
  tableId: "t4-1",
  partySize: 4,
  name: "Bo Chen",
  contact: "bo@example.com",
  notes: "",
});

describe("conversations", () => {
  it("lists and searches conversations, newest first", async () => {
    const tag = uid();
    const older = await conversation({ tag, startedAt: "2031-01-01T10:00:00.000Z" });
    const newer = await conversation({
      tag,
      startedAt: "2031-01-02T10:00:00.000Z",
      firstOutputMs: [400, 600],
    });
    await audit(
      newer,
      `act_${uid()}`,
      "book",
      ["proposed", "confirmed", "executed"],
      booking(`ev_${uid()}`, "2031-01-05T23:00:00.000Z"),
    );
    const rows = await listConversations(db, { source: "live", q: tag });
    expect(rows.map((r) => r.id)).toEqual([newer, older]);
    expect(rows[0]).toMatchObject({
      turnCount: 2,
      booked: true,
      lastCallerText: `hello ${tag} 2`,
      seeded: false,
    });
    expect(rows[1]!.booked).toBe(false);
    const page2 = await listConversations(db, {
      source: "live",
      q: tag,
      before: rows[0]!.startedAt,
    });
    expect(page2.map((r) => r.id)).toEqual([older]);
  });

  it("search treats % and _ literally", async () => {
    const tag = uid();
    const literal = await conversation({
      tag,
      startedAt: "2031-01-03T10:00:00.000Z",
      callerText: `${tag} save 50% off_peak`,
    });
    await conversation({
      tag,
      startedAt: "2031-01-03T11:00:00.000Z",
      callerText: `${tag} save 500 offXpeak`,
    });
    expect(
      (await listConversations(db, { source: "live", q: `${tag} save 50%` })).map((r) => r.id),
    ).toEqual([literal]);
    expect(
      (await listConversations(db, { source: "live", q: "off_peak" })).map((r) => r.id),
    ).toContain(literal);
    expect(
      (await listConversations(db, { source: "live", q: `${tag} save 50% off_peak'` })).length,
    ).toBe(0);
  });

  it("detail has turns, tool calls and audit trail in order", async () => {
    const tag = uid();
    const id = await conversation({
      tag,
      startedAt: "2031-01-04T10:00:00.000Z",
      firstOutputMs: [300, 900],
    });
    const actionId = `act_${uid()}`;
    await audit(
      id,
      actionId,
      "book",
      ["proposed", "confirmed", "executed"],
      booking(`ev_${uid()}`, "2031-01-06T23:00:00.000Z"),
    );
    const detail = await getConversation(db, id);
    expect(detail!.turns.map((t) => t.firstOutputMs)).toEqual([300, 900]);
    expect(detail!.turns[0]!.toolCalls).toEqual([
      { name: "check_availability", ms: 150, ok: true },
    ]);
    expect(detail!.audit.map((a) => a.stage)).toEqual(["proposed", "confirmed", "executed"]);
    expect(detail!.handoff).toBeNull();
    expect(await getConversation(db, "sess_missing")).toBeNull();
  });

  it("never returns an eval conversation", async () => {
    const tag = uid();
    const id = await conversation({ tag, source: "eval", startedAt: "2031-01-04T10:00:00.000Z" });
    expect(await getConversation(db, id)).toBeNull();
    expect(await listConversations(db, { source: "live", q: tag })).toEqual([]);
    expect(await listConversations(db, { source: "pilot", q: tag })).toEqual([]);
  });
});

describe("bookings", () => {
  it("reflect the latest executed action per reservation", async () => {
    const tag = uid();
    const id = await conversation({ tag, startedAt: "2031-02-01T10:00:00.000Z" });
    const eventId = `ev_${tag}`;
    const book = `act_${uid()}`;
    await audit(
      id,
      book,
      "book",
      ["proposed", "confirmed", "executed", "email_sent"],
      booking(eventId, "2031-02-07T23:00:00.000Z"),
    );
    const kept = `ev_kept_${tag}`;
    await audit(
      id,
      `act_${uid()}`,
      "book",
      ["proposed", "confirmed", "executed"],
      booking(kept, "2031-02-08T23:00:00.000Z"),
    );
    await audit(
      id,
      `act_${uid()}`,
      "cancel",
      ["proposed", "confirmed", "executed"],
      booking(eventId, "2031-02-07T23:00:00.000Z"),
    );
    const mine = (await listBookings(db, { source: "live" })).filter((b) => b.sessionId === id);
    expect(mine.map((b) => [b.reservationId, b.status])).toEqual(
      expect.arrayContaining([
        [eventId, "cancelled"],
        [kept, "booked"],
      ]),
    );
    expect(mine).toHaveLength(2);
    const k = mine.find((b) => b.reservationId === kept)!;
    expect(k).toMatchObject({
      name: "Bo Chen",
      partySize: 4,
      start: "2031-02-08T23:00:00.000Z",
      emailed: null,
    });
  });
});

describe("handoffs", () => {
  it("lists open tickets and resolves with notes once", async () => {
    const tag = uid();
    const sessionId = await conversation({
      tag,
      startedAt: "2031-02-02T10:00:00.000Z",
      outcome: "handoff",
    });
    const ticketId = `ho_${tag}`;
    await db.insert(handoffs).values({
      id: ticketId,
      sessionId,
      reason: "caller_request",
      summary: "Wants a private room",
      transcript: [{ role: "caller", text: "private room?", turnId: "t1" }],
      createdAt: "2031-02-02T10:05:00.000Z",
    });
    const open = await listHandoffs(db, { source: "live", status: "open" });
    expect(open.find((h) => h.id === ticketId)).toMatchObject({
      summary: "Wants a private room",
      resolvedAt: null,
    });
    const queue = new PgHandoffQueue(db);
    expect(
      await queue.resolve(ticketId, "Called back, booked the room", "2031-02-03T09:00:00.000Z"),
    ).toBe("resolved");
    expect(await queue.resolve(ticketId, "again", "2031-02-03T10:00:00.000Z")).toBe(
      "already_resolved",
    );
    expect(await queue.resolve("ho_missing", "x", "2031-02-03T10:00:00.000Z")).toBe("not_found");
    const resolved = await listHandoffs(db, { source: "live", status: "resolved" });
    expect(resolved.find((h) => h.id === ticketId)).toMatchObject({
      notes: "Called back, booked the room",
      resolvedAt: "2031-02-03T09:00:00.000Z",
    });
    expect((await getConversation(db, sessionId))!.handoff!.id).toBe(ticketId);
  });
});

/** A random day in 2032–2099: each run and test gets a window no other rows share. */
function freshWindow(): { now: Date; at: string; day: string } {
  const day0 = Date.UTC(2032, 0, 1) + Math.floor(Math.random() * 24_000) * 86_400_000;
  const now = new Date(day0 + 17 * 3_600_000); // 12:00 or 13:00 New York
  const at = new Date(day0 - 24 * 3_600_000 + 20 * 3_600_000).toISOString(); // the day before
  return { now, at, day: at.slice(0, 10) };
}

describe("metrics", () => {
  it("percentiles over first output and stages", async () => {
    const { now, at, day: yesterday } = freshWindow();
    await conversation({
      tag: uid(),
      startedAt: at,
      firstOutputMs: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
    });
    const m = await metrics(db, { source: "live", days: 7, now, timezone: TZ });
    expect(m.summary.latency.firstOutput).toEqual({ p50: 550, p95: 955 });
    expect(m.summary.latency.tool).toEqual({ p50: 275, p95: 477.5 });
    expect(m.summary.latency.stt).toEqual({ p50: null, p95: null });
    const day = m.daily.find((d) => d.day === yesterday)!;
    expect(day).toMatchObject({ conversations: 1, p50FirstOutputMs: 550, p95FirstOutputMs: 955 });
    expect(m.daily).toHaveLength(7);
    expect(m.daily.at(-1)!.day).toBe(now.toISOString().slice(0, 10));
  });

  it("task success and handoff rate, tokens and cost per conversation", async () => {
    const { now, at } = freshWindow();
    const a = await conversation({ tag: uid(), startedAt: at, tokens: [1000, 100], costUsd: 0.01 });
    const b = await conversation({ tag: uid(), startedAt: at, tokens: [1000, 100], costUsd: 0.01 });
    await conversation({
      tag: uid(),
      startedAt: at,
      outcome: "handoff",
      tokens: [1000, 100],
      costUsd: 0.01,
    });
    await conversation({ tag: uid(), startedAt: at, tokens: [1000, 100], costUsd: 0.01 });
    for (const s of [a, b]) {
      await audit(
        s,
        `act_${uid()}`,
        "book",
        ["proposed", "confirmed", "executed"],
        booking(`ev_${uid()}`, "2031-06-12T23:00:00.000Z"),
      );
    }
    const m = await metrics(db, { source: "live", days: 7, now, timezone: TZ });
    expect(m.summary).toMatchObject({
      conversations: 4,
      taskSuccessRate: 0.5,
      handoffRate: 0.25,
      avgTokens: 1100,
      avgCostUsd: 0.01,
    });
    expect(m.hasSeeded).toBe(false);
  });

  it("metrics never mix sources", async () => {
    const { now, at } = freshWindow();
    await conversation({ tag: uid(), startedAt: at, source: "live" });
    await conversation({ tag: uid(), startedAt: at, source: "pilot", firstOutputMs: [9000] });
    await conversation({ tag: uid(), startedAt: at, source: "eval", firstOutputMs: [7000] });
    const live = await metrics(db, { source: "live", days: 7, now, timezone: TZ });
    expect(live.summary.conversations).toBe(1);
    expect(live.summary.latency.firstOutput.p95).toBe(500);
    const pilot = await metrics(db, { source: "pilot", days: 7, now, timezone: TZ });
    expect(pilot.summary.conversations).toBe(1);
    expect(pilot.summary.latency.firstOutput.p50).toBe(9000);
  });

  it("pilot excludes seeded rows; live flags them", async () => {
    const { now, at } = freshWindow();
    await conversation({ tag: uid(), startedAt: at, source: "pilot", seeded: true });
    await conversation({ tag: uid(), startedAt: at, source: "live", seeded: true });
    const pilot = await metrics(db, { source: "pilot", days: 7, now, timezone: TZ });
    expect(pilot.summary).toMatchObject({
      conversations: 0,
      taskSuccessRate: null,
      handoffRate: null,
    });
    expect(pilot.hasSeeded).toBe(false);
    const live = await metrics(db, { source: "live", days: 7, now, timezone: TZ });
    expect(live.summary.conversations).toBe(1);
    expect(live.hasSeeded).toBe(true);
  });
});
