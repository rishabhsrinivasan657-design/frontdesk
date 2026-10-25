import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { DEMO_CONVERSATIONS, assertSeedable, resetDemo, seedDemo } from "./seed.js";
import { scratchDatabase } from "./test-db.js";

// A throwaway database: demo rows can't be deleted from the append-only audit log casually,
// so these tests never touch the shared one.
let scratch: Awaited<ReturnType<typeof scratchDatabase>>;
let conn: ReturnType<typeof createDb>;
beforeAll(async () => {
  scratch = await scratchDatabase("frontdesk_seedtest");
  conn = createDb(scratch.url);
});
afterAll(async () => {
  await conn.close();
  await scratch.drop();
});

const count = async (query: ReturnType<typeof sql>) =>
  Number(((await conn.db.execute(query)).rows[0] as { n: string }).n);

describe("seedDemo", () => {
  it("is idempotent", async () => {
    await seedDemo(conn.db, { now: new Date() });
    const first = await count(sql`select count(*) as n from conversations where id like 'demo_%'`);
    const audit = await count(
      sql`select count(*) as n from audit_log where session_id like 'demo_%'`,
    );
    const again = await seedDemo(conn.db, { now: new Date(Date.now() + 86_400_000) });
    expect(again.inserted).toBe(0);
    expect(first).toBe(DEMO_CONVERSATIONS);
    expect(await count(sql`select count(*) as n from conversations where id like 'demo_%'`)).toBe(
      first,
    );
    expect(
      await count(sql`select count(*) as n from audit_log where session_id like 'demo_%'`),
    ).toBe(audit);
  });

  it("writes only live seeded rows", async () => {
    await seedDemo(conn.db, { now: new Date() });
    expect(
      await count(sql`select count(*) as n from conversations
        where id like 'demo_%' and (source <> 'live' or not seeded)`),
    ).toBe(0);
  });

  it("has bookings, changes of mind, failures and an open/resolved handoff mix", async () => {
    await seedDemo(conn.db, { now: new Date() });
    const stage = (s: string) =>
      count(
        sql`select count(*) as n from audit_log where session_id like 'demo_%' and stage = ${s}`,
      );
    expect(await stage("executed")).toBeGreaterThanOrEqual(20);
    expect(await stage("voided")).toBeGreaterThanOrEqual(2);
    expect(await stage("failed")).toBeGreaterThanOrEqual(1);
    expect(
      await count(
        sql`select count(*) as n from handoffs where id like 'demo_%' and resolved_at is null`,
      ),
    ).toBe(4);
    expect(
      await count(
        sql`select count(*) as n from handoffs where id like 'demo_%' and resolved_at is not null`,
      ),
    ).toBe(2);
    expect(
      await count(sql`select count(*) as n from turns where conversation_id like 'demo_%'
        and first_output_ms is not null and jsonb_array_length(tool_calls) > 0`),
    ).toBeGreaterThan(40);
  });
});

describe("resetDemo", () => {
  it("removes only seeded demo rows, so a later seed starts fresh", async () => {
    await seedDemo(conn.db, { now: new Date() });
    await conn.db.execute(
      sql`insert into conversations (id, source, started_at) values ('sess_real', 'live', now())`,
    );
    await conn.db.execute(sql`insert into audit_log (at, session_id, action_id, kind, stage)
      values (now(), 'sess_real', 'act_real', 'book', 'proposed')`);
    await resetDemo(conn.db);
    expect(await count(sql`select count(*) as n from conversations where id like 'demo_%'`)).toBe(
      0,
    );
    expect(
      await count(sql`select count(*) as n from audit_log where session_id like 'demo_%'`),
    ).toBe(0);
    expect(
      await count(sql`select count(*) as n from audit_log where session_id = 'sess_real'`),
    ).toBe(1);
    // The append-only trigger is back in force for everything else.
    await expect(
      conn.db.execute(sql`delete from audit_log where session_id = 'sess_real'`),
    ).rejects.toThrow();
    expect((await seedDemo(conn.db, { now: new Date() })).inserted).toBe(DEMO_CONVERSATIONS);
  });
});

describe("assertSeedable", () => {
  it("refuses the eval database", () => {
    expect(() => assertSeedable("postgres://u:p@localhost:54320/frontdesk_eval")).toThrow("eval");
    expect(() => assertSeedable("postgres://u:p@localhost:54320/frontdesk")).not.toThrow();
  });
});
