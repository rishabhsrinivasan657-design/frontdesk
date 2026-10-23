import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Clock, Mailer } from "@frontdesk/core";
import { createDb, PgAuditLog, PgHandoffQueue } from "@frontdesk/db";
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

function realMailer(): Mailer {
  // M5 part B wires GmailMailer here. Until then the worker must not pretend to send.
  throw new Error("No real Mailer yet: the Gmail adapter arrives in M5 part B");
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
