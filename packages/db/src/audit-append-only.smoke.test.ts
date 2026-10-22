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
      (await client.query<{ count: string }>("select count(*) from audit_log")).rows[0]!.count,
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
});
