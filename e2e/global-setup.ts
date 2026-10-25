import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import { ADMIN_DATABASE_URL, E2E_DATABASE_URL, E2E_NOW } from "./e2e-db";

/** Creates (once) and migrates the e2e database, then replaces its demo data. */
export default async function globalSetup(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    const { rowCount } = await admin.query(
      "select 1 from pg_database where datname = 'frontdesk_e2e'",
    );
    if (!rowCount) await admin.query("create database frontdesk_e2e");
  } finally {
    await admin.end();
  }
  const run = (args: string[]) =>
    execFileSync("pnpm", args, {
      cwd: resolve(import.meta.dirname, ".."),
      env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, FRONTDESK_NOW: E2E_NOW },
      stdio: "inherit",
    });
  run(["db:migrate"]);
  // --reset: every run starts with the same open handoffs and fresh demo dates.
  run(["db:seed", "--reset"]);
}
