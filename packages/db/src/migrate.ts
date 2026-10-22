import { fileURLToPath } from "node:url";
import { migrate as runMigrations } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.js";

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Applies every pending migration in packages/db/drizzle. Safe to run repeatedly. */
export async function migrate(url: string): Promise<void> {
  const conn = createDb(url);
  try {
    await runMigrations(conn.db, { migrationsFolder: MIGRATIONS });
  } finally {
    await conn.close();
  }
}
