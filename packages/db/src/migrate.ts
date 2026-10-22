import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as runMigrations } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));
/** Arbitrary constant: every Front Desk process migrating one database waits on this key. */
const MIGRATION_LOCK = 4_204_105;

/** Applies every pending migration in packages/db/drizzle. Safe to run repeatedly and concurrently. */
export async function migrate(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await runMigrations(drizzle(client), { migrationsFolder: MIGRATIONS });
  } finally {
    await client.end(); // ending the session releases the advisory lock
  }
}
