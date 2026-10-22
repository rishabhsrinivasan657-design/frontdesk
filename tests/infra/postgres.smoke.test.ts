import pg from "pg";
import { describe, expect, it } from "vitest";
import { infraEnv } from "./env";

const UP_HINT = "Is Postgres running? Try: pnpm infra:up (docker compose up -d)";

async function query(url: string, sql: string) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(`${UP_HINT}\n${(e as Error).message}`);
  }
  try {
    return await client.query<Record<string, unknown>>(sql);
  } finally {
    await client.end();
  }
}

describe("postgres", () => {
  it("live database answers", async () => {
    const r = await query(infraEnv().databaseUrl, "select 1 as ok");
    expect(r.rows[0]?.ok).toBe(1);
  });

  it("separate eval database exists", async () => {
    const r = await query(
      infraEnv().databaseUrl,
      "select 1 from pg_database where datname = 'frontdesk_eval'",
    );
    expect(
      r.rowCount,
      "frontdesk_eval missing: your volume predates the init script. Run: docker compose down -v && pnpm infra:up",
    ).toBe(1);
  });

  it("fails fast with an actionable message when nothing is listening", async () => {
    const started = Date.now();
    await expect(query("postgres://x:x@localhost:1/x", "select 1")).rejects.toThrow(
      /docker compose up -d/,
    );
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
