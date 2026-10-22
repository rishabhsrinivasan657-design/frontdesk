import pg from "pg";
import { describe, expect, it } from "vitest";
import { infraEnv } from "./env";

const UP_HINT = "Is Postgres running? Try: pnpm infra:up (docker compose up -d)";
const MISSING_DB_HINT =
  "Database missing: your Postgres volume predates the init script. Run: docker compose down -v && pnpm infra:up";

async function query(url: string, sql: string) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
  } catch (e) {
    const hint = (e as { code?: string }).code === "3D000" ? MISSING_DB_HINT : UP_HINT;
    throw new Error(`${hint}\n${(e as Error).message}`);
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

  it("separate eval database answers via EVAL_DATABASE_URL", async () => {
    const r = await query(infraEnv().evalDatabaseUrl, "select current_database() as db");
    expect(r.rows[0]?.db).toBe("frontdesk_eval");
  });

  it("names the fix when the database is missing from an old volume", async () => {
    const missing = infraEnv().databaseUrl.replace(/\/frontdesk$/, "/frontdesk_missing");
    await expect(query(missing, "select 1")).rejects.toThrow(/docker compose down -v/);
  });

  it("fails fast with an actionable message when nothing is listening", async () => {
    const started = Date.now();
    await expect(query("postgres://x:x@localhost:1/x", "select 1")).rejects.toThrow(
      /docker compose up -d/,
    );
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
