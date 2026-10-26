import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Clock, type Mailer, parseBusinessConfig } from "@frontdesk/core";
import { createDb, PgAuditLog, PgHandoffQueue, purgePilotPii } from "@frontdesk/db";
import { createGmailMailer, createGoogleCalendar, readGoogleEnv } from "@frontdesk/integrations";
import { config, parse } from "dotenv";
import { Redis } from "ioredis";
import { RedisEmailQuota } from "./email-quota.js";
import { startHeartbeat } from "./heartbeat.js";
import { readKeyTag } from "./key-tag.js";
import { assertPilotSafe, readConversationSource } from "./pilot-guard.js";
import { startRetentionSchedule } from "./retention-job.js";
import { startConfirmationWorker } from "./worker.js";

const root = resolve(import.meta.dirname, "../../..");
config({ path: resolve(root, ".env"), quiet: true });
const defaults = parse(readFileSync(resolve(root, ".env.example")));
const env = (key: string) => process.env[key] ?? defaults[key] ?? "";
assertPilotSafe({ ...defaults, ...process.env });

const clock: Clock = {
  now: () => new Date(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** Gmail, with times rendered in the business's time zone. Refuses to start without credentials. */
function realMailer(): Mailer {
  const google = readGoogleEnv();
  if (!google) {
    throw new Error("Google credentials missing from .env: follow docs/google-setup.md");
  }
  const configPath = resolve(root, env("BUSINESS_CONFIG") || "businesses/casa-fiorella.yaml");
  const config = parseBusinessConfig(readFileSync(configPath, "utf8"));
  return createGmailMailer(google, config.business.timezone);
}

const pg = createDb(env("DATABASE_URL"));
const redis = new Redis(env("REDIS_URL"), { maxRetriesPerRequest: 2 });
const worker = startConfirmationWorker({
  redisUrl: env("REDIS_URL"),
  deps: {
    mailer: realMailer(),
    attempts: new PgAuditLog(pg.db),
    handoffs: new PgHandoffQueue(pg.db),
    clock,
    quota: new RedisEmailQuota(redis, readKeyTag({ KEY_HASH_SECRET: env("KEY_HASH_SECRET") })),
  },
});
// Retention runs only for the pilot: it is the only source with real callers' data, and it
// must never rewrite bookings on a calendar someone is using for local testing.
const google = readGoogleEnv();
const retention =
  readConversationSource({ CONVERSATION_SOURCE: env("CONVERSATION_SOURCE") }) === "pilot"
    ? await startRetentionSchedule({
        redisUrl: env("REDIS_URL"),
        deps: {
          clock,
          purge: (o) => purgePilotPii(pg.db, o),
          ...(google
            ? {
                redactCalendar: (before: Date) =>
                  createGoogleCalendar(google).redactReservationsBefore(before),
              }
            : {}),
          log: (line) => console.log(line),
        },
      })
    : undefined;
const stopHeartbeat = startHeartbeat(redis);
console.log(`confirmation worker started (retention ${retention ? "on" : "off"})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopHeartbeat();
    void worker
      .close()
      .then(() => retention?.close())
      .then(() => pg.close())
      .then(() => redis.disconnect())
      .then(() => process.exit(0));
  });
}
