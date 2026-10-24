import { type Page, expect } from "@playwright/test";
import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://frontdesk:frontdesk@localhost:54320/frontdesk";

export const DETAILS = "Bo Chen, bo@example.com";
export const bookAt = (time: string) => `A table for 4 on 2026-11-07 at ${time}`;

/** Types a caller message once the composer is free, and sends it. */
export async function say(page: Page, text: string): Promise<void> {
  const input = page.getByTestId("composer-input");
  await expect(input).toBeEnabled();
  await input.fill(text);
  await input.press("Enter");
}

export async function sessionId(page: Page): Promise<string> {
  const id = await page.evaluate(() => sessionStorage.getItem("frontdesk.sessionId"));
  if (!id) throw new Error("no session id in sessionStorage");
  return id;
}

async function query<T>(sql: string, params: unknown[]): Promise<T[]> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

/** Audit stages for a session, in order, as "actionId:stage". */
export async function auditTrail(session: string): Promise<{ actionId: string; stage: string }[]> {
  return query(
    'select action_id as "actionId", stage from audit_log where session_id = $1 order by seq',
    [session],
  );
}

export async function storedTurns(
  session: string,
): Promise<{ turnIndex: number; totalMs: number | null }[]> {
  return query(
    'select turn_index as "turnIndex", total_ms as "totalMs" from turns where conversation_id = $1 order by turn_index',
    [session],
  );
}

export async function handoffCount(session: string): Promise<number> {
  const rows = await query<{ n: string }>(
    "select count(*) as n from handoffs where session_id = $1",
    [session],
  );
  return Number(rows[0]?.n ?? 0);
}
