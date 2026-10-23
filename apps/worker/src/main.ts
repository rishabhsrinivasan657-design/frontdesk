import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Clock, type Mailer, parseBusinessConfig } from "@frontdesk/core";
import { createDb, PgAuditLog, PgHandoffQueue } from "@frontdesk/db";
import { createGmailMailer, readGoogleEnv } from "@frontdesk/integrations";
import { config, parse } from "dotenv";
import { startConfirmationWorker } from "./worker.js";

const root = resolve(import.meta.dirname, "../../..");
config({ path: resolve(root, ".env"), quiet: true });
const defaults = parse(readFileSync(resolve(root, ".env.example")));
const env = (key: string) => process.env[key] ?? defaults[key] ?? "";

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
const worker = startConfirmationWorker({
  redisUrl: env("REDIS_URL"),
  deps: {
    mailer: realMailer(),
    attempts: new PgAuditLog(pg.db),
    handoffs: new PgHandoffQueue(pg.db),
    clock,
  },
});
console.log("confirmation worker started");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void worker
      .close()
      .then(() => pg.close())
      .then(() => process.exit(0));
  });
}
