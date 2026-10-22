import pg from "pg";
import { describe, expect, it } from "vitest";
import { migrate } from "./migrate.js";
import { TEST_DATABASES } from "./test-db.js";

async function rows<T>(url: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

describe.each(Object.entries(TEST_DATABASES))("migrations on the %s database", (_name, url) => {
  it("migrates twice without error", async () => {
    await migrate(url);
    await migrate(url);
  });

  it("creates every table", async () => {
    const tables = await rows<{ table_name: string }>(
      url,
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    expect(tables.map((t) => t.table_name)).toEqual(
      expect.arrayContaining(["conversations", "turns", "audit_log", "handoffs", "feedback"]),
    );
  });

  it("turns has every per-turn metric column (spec §8)", async () => {
    const cols = await rows<{ column_name: string }>(
      url,
      "select column_name from information_schema.columns where table_name = 'turns'",
    );
    expect(cols.map((c) => c.column_name)).toEqual(
      expect.arrayContaining([
        "stt_ms",
        "llm_ttft_ms",
        "llm_total_ms",
        "tool_ms",
        "tts_start_ms",
        "total_ms",
        "tokens_in",
        "tokens_out",
        "cost_usd",
      ]),
    );
  });
});
