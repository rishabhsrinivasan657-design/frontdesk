import { randomUUID } from "node:crypto";
import { type Page, expect } from "@playwright/test";
import pg from "pg";
import { E2E_DATABASE_URL } from "./e2e-db";

/**
 * A fresh caller per booking: specs share one api (and its calendar), and the agent rightly
 * refuses a second overlapping table for the same name and contact.
 */
export function details(): string {
  const n = randomUUID().slice(0, 8);
  return `Guest ${n}, guest-${n}@example.com`;
}

/**
 * The e2e owner login (test values only). The hash is bcrypt cost 4 of the password, committed
 * so the config needs no bcrypt package; the api reads it as OWNER_PASSWORD_HASH.
 */
export const OWNER = {
  email: "owner@casafiorella.test",
  password: "e2e owner password 4100",
  hash: "$2b$04$zGRBuJXA..TXLRGncglpbO1mumfkno701z5J1At0XT9xXagCsVAs.",
} as const;
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
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
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
): Promise<
  { turnIndex: number; totalMs: number | null; sttMs: number | null; ttsStartMs: number | null }[]
> {
  return query(
    'select turn_index as "turnIndex", total_ms as "totalMs", stt_ms as "sttMs", tts_start_ms as "ttsStartMs" from turns where conversation_id = $1 order by turn_index',
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

/** A seeded demo conversation that ended in a booking written to Calendar. */
export async function demoBookingSession(): Promise<string> {
  const rows = await query<{ id: string }>(
    "select session_id as id from audit_log where session_id like 'demo\\_%' and stage = 'executed' order by seq limit 1",
    [],
  );
  if (!rows[0]) throw new Error("no seeded booking: did the e2e global setup run pnpm db:seed?");
  return rows[0].id;
}
