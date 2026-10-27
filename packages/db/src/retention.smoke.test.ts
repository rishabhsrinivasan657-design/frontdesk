import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { purgePilotPii } from "./retention.js";
import { auditLog, conversations, feedback, handoffs, turns } from "./schema.js";
import { scratchDatabase } from "./test-db.js";

let scratch: Awaited<ReturnType<typeof scratchDatabase>>;
let conn: ReturnType<typeof createDb>;
beforeAll(async () => {
  scratch = await scratchDatabase("frontdesk_retention");
  conn = createDb(scratch.url);
});
afterAll(async () => {
  await conn.close();
  await scratch.drop();
});

const NOW = new Date("2026-12-31T12:00:00.000Z");
const BEFORE = new Date(NOW.getTime() - 30 * 86_400_000);
const OLD = "2026-11-01T18:00:00.000Z";
const RECENT = "2026-12-20T18:00:00.000Z";

/** A conversation with one turn, a handoff, feedback and a booked audit trail, all with PII. */
async function seed(o: { source: "live" | "pilot"; startedAt: string; seeded?: boolean }) {
  const db = conn.db;
  const id = `sess_${randomUUID().slice(0, 8)}`;
  await db.insert(conversations).values({
    id,
    source: o.source,
    seeded: o.seeded ?? false,
    startedAt: o.startedAt,
    outcome: "handoff",
  });
  await db.insert(turns).values({
    id: `turn_${id}`,
    conversationId: id,
    turnIndex: 1,
    callerText: "I'm Ana Ruiz, ana@example.com, 555-0100",
    agentText: "Thanks Ana Ruiz!",
    totalMs: 900,
    firstOutputMs: 400,
    tokensIn: 100,
    tokensOut: 20,
    costUsd: 0,
    createdAt: o.startedAt,
  });
  await db.insert(handoffs).values({
    id: `ho_${id}`,
    sessionId: id,
    reason: "human_requested",
    summary: "Ana Ruiz wants a private room",
    transcript: [{ role: "caller", text: "Ana Ruiz here", turnId: "t1" }],
    createdAt: o.startedAt,
    resolvedAt: o.startedAt,
    notes: "Called Ana on 555-0100",
    outcome: "booked_by_staff",
  });
  await db.insert(feedback).values({
    id: `fb_${id}`,
    conversationId: id,
    rating: 4,
    comment: "Ana here, lovely",
    createdAt: o.startedAt,
  });
  const actionId = `act_${id}`;
  await db.insert(auditLog).values([
    {
      at: o.startedAt,
      sessionId: id,
      actionId,
      kind: "book",
      stage: "executed",
      args: {
        kind: "book",
        name: "Ana Ruiz",
        contact: "ana@example.com",
        partySize: 4,
        notes: "nut allergy",
      },
      result: {
        booking: { id: "ev1", name: "Ana Ruiz", contact: "ana@example.com", partySize: 4 },
      },
    },
    {
      at: o.startedAt,
      sessionId: id,
      actionId,
      kind: "book",
      stage: "email_failed",
      result: { attempt: 1 },
      reason: "550 mailbox ana@example.com unavailable",
    },
  ]);
  return id;
}

const dump = async (id: string) =>
  JSON.stringify([
    await conn.db.select().from(turns).where(eq(turns.conversationId, id)),
    await conn.db.select().from(handoffs).where(eq(handoffs.sessionId, id)),
    await conn.db.select().from(feedback).where(eq(feedback.conversationId, id)),
    await conn.db.select().from(auditLog).where(eq(auditLog.sessionId, id)),
  ]);

describe("purgePilotPii", () => {
  it("redacts pilot rows older than 30 days", async () => {
    const id = await seed({ source: "pilot", startedAt: OLD });
    const result = await purgePilotPii(conn.db, { before: BEFORE, now: NOW });
    expect(result.conversations).toBeGreaterThanOrEqual(1);
    const out = await dump(id);
    for (const pii of ["Ana", "ana@example.com", "555-0100", "nut allergy", "private room"]) {
      expect(out).not.toContain(pii);
    }
    const [c] = await conn.db.select().from(conversations).where(eq(conversations.id, id));
    expect(c!.piiPurgedAt).not.toBeNull();
  });

  it("keeps counts, ratings, outcomes and latencies", async () => {
    const id = await seed({ source: "pilot", startedAt: OLD });
    await purgePilotPii(conn.db, { before: BEFORE, now: NOW });
    const [t] = await conn.db.select().from(turns).where(eq(turns.conversationId, id));
    expect(t).toMatchObject({ totalMs: 900, firstOutputMs: 400, tokensIn: 100 });
    const [h] = await conn.db.select().from(handoffs).where(eq(handoffs.sessionId, id));
    expect(h).toMatchObject({ reason: "human_requested", outcome: "booked_by_staff" });
    const [f] = await conn.db.select().from(feedback).where(eq(feedback.conversationId, id));
    expect(f!.rating).toBe(4);
    const audit = await conn.db.select().from(auditLog).where(eq(auditLog.sessionId, id));
    expect(audit.map((a) => a.stage)).toEqual(["executed", "email_failed"]);
    expect(audit[0]!.args).toMatchObject({ kind: "book", partySize: 4 });
  });

  it("leaves live, seeded and recent rows untouched", async () => {
    const live = await seed({ source: "live", startedAt: OLD });
    const seeded = await seed({ source: "pilot", startedAt: OLD, seeded: true });
    const recent = await seed({ source: "pilot", startedAt: RECENT });
    await purgePilotPii(conn.db, { before: BEFORE, now: NOW });
    for (const id of [live, seeded, recent]) expect(await dump(id)).toContain("Ana Ruiz");
  });

  it("is idempotent", async () => {
    await seed({ source: "pilot", startedAt: OLD });
    await purgePilotPii(conn.db, { before: BEFORE, now: NOW });
    expect(await purgePilotPii(conn.db, { before: BEFORE, now: NOW })).toEqual({
      conversations: 0,
    });
    const left = await conn.db.execute(
      sql`select count(*)::int as n from conversations where source = 'pilot' and not seeded and started_at < ${BEFORE.toISOString()} and pii_purged_at is null`,
    );
    expect((left.rows[0] as { n: number }).n).toBe(0);
  });
});
