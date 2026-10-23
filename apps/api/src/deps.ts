import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { type AgentDeps, type Calendar, InMemoryCalendar } from "@frontdesk/core";
import { createDb, PgAuditLog, PgConversations, PgHandoffQueue } from "@frontdesk/db";
import { createGoogleCalendar, readGoogleEnv } from "@frontdesk/integrations";
import { loadCatalog, type Price } from "@frontdesk/llm";
import { createConfirmationQueue, QueueMailer } from "@frontdesk/worker";
import { Redis } from "ioredis";
import { loadBusinessConfig } from "./business-config.js";
import type { ChatContext } from "./chat/connection.js";
import { offsetClock } from "./clock.js";
import { buildLLM } from "./llm/build.js";
import { RedisSessionStore } from "./redis/session-store.js";
import { RedisSlotLock } from "./redis/slot-lock.js";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const FREE: Price = { input: 0, output: 0 };

export type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is not set (see .env.example)`);
  return value;
}

/**
 * Picks every adapter from env (spec §3): Google Calendar when GOOGLE_* are set, else in memory;
 * Redis sessions and locks; Postgres audit, handoffs and turns; confirmation emails queued for
 * the worker. Throws on a bad config so the process refuses to start.
 */
export async function buildDeps(
  env: Env,
): Promise<{ chat: ChatContext; summary: string; close(): Promise<void> }> {
  const config = loadBusinessConfig(
    resolve(REPO_ROOT, env.BUSINESS_CONFIG || "businesses/casa-fiorella.yaml"),
  );
  const fixedNow = env.FRONTDESK_NOW?.trim();
  const clock = offsetClock(fixedNow ? new Date(fixedNow) : undefined);
  if (fixedNow && Number.isNaN(clock.now().getTime())) {
    throw new Error("FRONTDESK_NOW must be an ISO 8601 time");
  }
  const redisUrl = required(env, "REDIS_URL");
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
  // Fail at startup, not on the first caller, when Redis is down.
  await redis.ping();
  const pg = createDb(required(env, "DATABASE_URL"));
  const queue = createConfirmationQueue(redisUrl, env.QUEUE_PREFIX?.trim() || undefined);
  const ids = (prefix: string) => `${prefix}_${randomUUID()}`;

  const google = readGoogleEnv(env);
  const calendar: Calendar = google ? createGoogleCalendar(google) : new InMemoryCalendar([], ids);
  const llm = buildLLM(env, redis);
  const price = loadCatalog().get(llm.model)?.pricePerMTok ?? FREE;

  const deps: AgentDeps = {
    config,
    calendar,
    clock,
    ids,
    llm,
    // expiresAt comes from this clock, so the pending TTL must too.
    sessions: new RedisSessionStore(redis, { now: () => clock.now().getTime() }),
    locks: new RedisSlotLock(redis),
    audit: new PgAuditLog(pg.db),
    handoffs: new PgHandoffQueue(pg.db),
    mailer: new QueueMailer(queue),
  };

  return {
    chat: {
      deps,
      log: new PgConversations(pg.db),
      price,
      newSessionId: () => `sess_${randomUUID()}`,
      logger: { error: (obj, msg) => console.error(msg, obj) },
    },
    summary: `calendar=${google ? "google" : "in-memory"} llm=${llm.model}${fixedNow ? " now=fixed" : ""}`,
    async close() {
      await queue.close();
      redis.disconnect();
      await pg.close();
    },
  };
}
