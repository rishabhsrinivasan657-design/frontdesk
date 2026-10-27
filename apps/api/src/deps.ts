import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { type AgentDeps, type Calendar, InMemoryCalendar } from "@frontdesk/core";
import { createDb, PgAuditLog, PgConversations, PgHandoffQueue } from "@frontdesk/db";
import { sql } from "drizzle-orm";
import {
  checkGoogleToken,
  createGoogleCalendar,
  createOAuthClient,
  readGoogleEnv,
} from "@frontdesk/integrations";
import { loadCatalog, type Price } from "@frontdesk/llm";
import {
  HEARTBEAT_KEY,
  assertPilotSafe,
  readKeyTag,
  createConfirmationQueue,
  QueueMailer,
  readConversationSource,
} from "@frontdesk/worker";
import { Redis } from "ioredis";
import { type BotCheck, TurnstileBotCheck } from "./abuse/bot-check.js";
import { RedisBookingQuota } from "./abuse/booking-quota.js";
import { type ChatGuard, ChatLimits, DEFAULT_CHAT_LIMITS } from "./abuse/chat-limits.js";
import { RedisWindowCounter, type WindowCounter } from "./abuse/window-counter.js";
import { loadBusinessConfig } from "./business-config.js";
import { type Readiness, readiness } from "./health.js";
import type { ChatContext } from "./chat/connection.js";
import { SessionHub } from "./chat/hub.js";
import { offsetClock } from "./clock.js";
import { buildLLM } from "./llm/build.js";
import { RedisSessionStore } from "./redis/session-store.js";
import { RedisSlotLock } from "./redis/slot-lock.js";
import type { OwnerContext } from "./owner/context.js";
import type { OwnerRouteSet } from "./owner/plugin.js";
import { pgOwnerReads } from "./owner/reads.js";
import { ownerRestRoutes } from "./owner/routes.js";
import { OwnerFeed } from "./owner/feed.js";
import { ownerLiveRoutes } from "./owner/live.js";
import { RedisOwnerSessionStore } from "./owner/session-store.js";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const FREE: Price = { input: 0, output: 0 };

export type Env = Record<string, string | undefined>;

/** The api must never read or write the eval database: eval numbers stay apart (spec §10). */
export function assertNotEvalDatabase(
  databaseUrl: string,
  evalDatabaseUrl: string | undefined,
): void {
  const name = (url: string) => new URL(url).pathname.replace(/^\//, "");
  const db = name(databaseUrl);
  if (db.endsWith("_eval") || (evalDatabaseUrl && name(evalDatabaseUrl) === db)) {
    throw new Error("DATABASE_URL points at the eval database");
  }
}

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
export async function buildDeps(env: Env): Promise<{
  chat: ChatContext;
  owner: OwnerContext | undefined;
  ownerRoutes: OwnerRouteSet[];
  chatGuard: ChatGuard | undefined;
  botCheck: BotCheck | undefined;
  ready: () => Promise<Readiness>;
  summary: string;
  close(): Promise<void>;
}> {
  assertPilotSafe(env);
  const source = readConversationSource(env);
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
  const databaseUrl = required(env, "DATABASE_URL");
  assertNotEvalDatabase(databaseUrl, env.EVAL_DATABASE_URL?.trim() || undefined);
  const pg = createDb(databaseUrl);
  const queue = createConfirmationQueue(redisUrl, env.QUEUE_PREFIX?.trim() || undefined);
  const ids = (prefix: string) => `${prefix}_${randomUUID()}`;

  const google = readGoogleEnv(env);
  const calendar: Calendar = google ? createGoogleCalendar(google) : new InMemoryCalendar([], ids);
  const llm = buildLLM(env, redis);
  const price = loadCatalog().get(llm.model)?.pricePerMTok ?? FREE;

  const limits = chatLimitsEnabled(env);
  const keyTag = readKeyTag(env);
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
    ...(limits ? { bookingQuota: new RedisBookingQuota(redis, keyTag) } : {}),
  };

  const owner = readOwnerEnv(env, redis);

  const now = () => clock.now();
  const hub = new SessionHub();
  const feed = new OwnerFeed();
  const ownerRoutes = [
    ownerLiveRoutes({ hub, sessions: deps.sessions, clock, feed }),
    ownerRestRoutes({
      reads: pgOwnerReads(pg.db, { timezone: config.business.timezone, now }),
      calendarId: google ? google.calendarId : null,
      now,
    }),
  ];

  const chatGuard = buildChatGuard(env, new RedisWindowCounter(redis));

  const botCheck = readBotCheck(env);
  const ready = readiness({
    redis: async () => (await redis.ping()) === "PONG",
    postgres: async () => (await pg.db.execute(sql`select 1`), true),
    // Without Google, production can't book: fail there; locally the in-memory calendar is fine.
    google: () =>
      google
        ? checkGoogleToken(() => createOAuthClient(google))
        : Promise.resolve(env.NODE_ENV !== "production"),
    worker: async () => (await redis.exists(HEARTBEAT_KEY)) === 1,
  });

  return {
    owner,
    ownerRoutes,
    chatGuard,
    botCheck,
    ready,
    chat: {
      deps,
      log: new PgConversations(pg.db),
      price,
      newSessionId: () => `sess_${randomUUID()}`,
      logger: { error: (obj, msg) => console.error(msg, obj) },
      hub,
      feed,
      source,
    },
    summary: `source=${source} limits=${chatGuard ? "on" : "off"} botcheck=${botCheck ? "on" : "off"} calendar=${google ? "google" : "in-memory"} llm=${llm.model} owner=${owner ? "on" : "off"}${fixedNow ? " now=fixed" : ""}`,
    async close() {
      await queue.close();
      redis.disconnect();
      await pg.close();
    },
  };
}

/** Turnstile before a new chat (M10). Off without a secret; the production guard requires one. */
export function readBotCheck(env: Env): BotCheck | undefined {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return undefined;
  const hostnames = (env.TURNSTILE_HOSTNAMES ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (hostnames.length === 0) {
    throw new Error("TURNSTILE_HOSTNAMES must list the site's hostnames (see .env.example)");
  }
  return new TurnstileBotCheck({ secret, hostnames });
}

/**
 * The chat limits and the bookings-per-contact cap (M10) are always on in production; locally
 * only with CHAT_LIMITS=on.
 */
export function chatLimitsEnabled(env: Env): boolean {
  return env.NODE_ENV === "production" || env.CHAT_LIMITS?.trim() === "on";
}

/** The chat limits (M10) when enabled, keyed with KEY_HASH_SECRET. */
export function buildChatGuard(env: Env, counter: WindowCounter): ChatGuard | undefined {
  return chatLimitsEnabled(env)
    ? new ChatLimits(counter, DEFAULT_CHAT_LIMITS, readKeyTag(env))
    : undefined;
}

/** The dashboard login (spec §10). Both values unset → the owner api is off (503). */
export function readOwnerEnv(env: Env, redis: Redis): OwnerContext | undefined {
  const email = env.OWNER_EMAIL?.trim();
  const passwordHash = env.OWNER_PASSWORD_HASH?.trim();
  if (!email && !passwordHash) return undefined;
  if (!email || !passwordHash) {
    throw new Error("Set both OWNER_EMAIL and OWNER_PASSWORD_HASH, or neither (see .env.example)");
  }
  if (!/^\$2[aby]\$\d{2}\$.{53}$/.test(passwordHash)) {
    throw new Error("OWNER_PASSWORD_HASH must be a bcrypt hash (pnpm owner:hash)");
  }
  const hours = Number(env.OWNER_SESSION_TTL_HOURS?.trim() || 12);
  if (!(hours > 0)) throw new Error("OWNER_SESSION_TTL_HOURS must be a positive number");
  const sessionTtlMs = hours * 3_600_000;
  return {
    email,
    passwordHash,
    sessions: new RedisOwnerSessionStore(redis, sessionTtlMs, readKeyTag(env)),
    sessionTtlMs,
    secureCookie: env.NODE_ENV === "production",
  };
}
