import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "./migrate.js";
import { TEST_DATABASES } from "./test-db.js";

describe.each(Object.entries(TEST_DATABASES))("audit_log on the %s database", (_name, url) => {
  const client = new pg.Client({ connectionString: url });
  const actionId = `act_${randomUUID()}`;
  const count = async () =>
    Number(
      (
        await client.query<{ count: string }>(
          "select count(*) from audit_log where action_id = $1",
          [actionId],
        )
      ).rows[0]!.count,
    );

  beforeAll(async () => {
    await migrate(url);
    await client.connect();
    await client.query(
      `insert into audit_log (at, session_id, action_id, kind, stage)
       values (now(), 's_test', $1, 'book', 'proposed')`,
      [actionId],
    );
  });
  afterAll(() => client.end());

  it("rejects UPDATE", async () => {
    await expect(
      client.query("update audit_log set reason = 'x' where action_id = $1", [actionId]),
    ).rejects.toThrow(/append-only/);
  });

  it("rejects DELETE", async () => {
    await expect(
      client.query("delete from audit_log where action_id = $1", [actionId]),
    ).rejects.toThrow(/append-only/);
  });

  it("rejects TRUNCATE", async () => {
    await expect(client.query("truncate audit_log")).rejects.toThrow(/append-only/);
  });

  it("still accepts INSERT", async () => {
    const before = await count();
    await client.query(
      `insert into audit_log (at, session_id, action_id, kind, stage)
       values (now(), 's_test', $1, 'book', 'confirmed')`,
      [actionId],
    );
    expect(await count()).toBe(before + 1);
  });

  /** The retention job's one narrow exception (M10): args/result only, flag set, in a transaction. */
  const asRetention = async (sql: string) => {
    await client.query("begin");
    try {
      await client.query("set local frontdesk.retention = 'on'");
      await client.query(sql, [actionId]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  };

  it("audit UPDATE without the retention flag is rejected", async () => {
    await expect(
      client.query(`update audit_log set args = '{}'::jsonb where action_id = $1`, [actionId]),
    ).rejects.toThrow(/append-only/);
  });

  it("audit UPDATE with the flag may change args only", async () => {
    await asRetention(
      `update audit_log set args = '{"name":"[redacted]"}'::jsonb, result = null where action_id = $1`,
    );
    const rows = await client.query<{ args: unknown }>(
      "select args from audit_log where action_id = $1",
      [actionId],
    );
    expect(rows.rows.every((r) => JSON.stringify(r.args).includes("[redacted]"))).toBe(true);
  });

  it("audit UPDATE with the flag that changes stage is rejected", async () => {
    await expect(
      asRetention(`update audit_log set stage = 'executed' where action_id = $1`),
    ).rejects.toThrow(/append-only/);
  });

  it("audit DELETE is rejected even with the flag", async () => {
    await expect(asRetention(`delete from audit_log where action_id = $1`)).rejects.toThrow(
      /append-only/,
    );
  });
});
