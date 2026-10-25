import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config, parse } from "dotenv";
import { createDb } from "./client.js";
import { assertSeedable, resetDemo, seedDemo } from "./seed.js";

/** `pnpm db:seed [--reset]`: demo data for the owner dashboard, in DATABASE_URL only. */
const root = resolve(import.meta.dirname, "../../..");
config({ path: resolve(root, ".env"), quiet: true });
const defaults = parse(readFileSync(resolve(root, ".env.example")));
const url = process.env.DATABASE_URL ?? defaults.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set; add it to .env (see .env.example)");
assertSeedable(url);

const conn = createDb(url);
try {
  if (process.argv.includes("--reset")) {
    await resetDemo(conn.db);
    console.log("removed the previous demo rows");
  }
  // Tests pin the api's clock (FRONTDESK_NOW); demo dates follow it so they stay in its window.
  const fixed = process.env.FRONTDESK_NOW?.trim();
  const now = fixed ? new Date(fixed) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("FRONTDESK_NOW must be an ISO 8601 time");
  const { inserted } = await seedDemo(conn.db, { now });
  // The database name only: the URL holds a password.
  const name = new URL(url).pathname.slice(1);
  console.log(
    inserted > 0
      ? `seeded ${inserted} demo conversations into ${name}`
      : `demo data already in ${name} (run with --reset for fresh dates)`,
  );
} finally {
  await conn.close();
}
