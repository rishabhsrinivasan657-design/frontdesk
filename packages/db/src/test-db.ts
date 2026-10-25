/** Docker Compose defaults; CI overrides them with env (see .github/workflows/ci.yml). */
export const TEST_DATABASES = {
  live: process.env.DATABASE_URL ?? "postgres://frontdesk:frontdesk@localhost:54320/frontdesk",
  eval:
    process.env.EVAL_DATABASE_URL ??
    "postgres://frontdesk:frontdesk@localhost:54320/frontdesk_eval",
} as const;

/**
 * A fresh, migrated database for one test file, dropped afterwards. For tests whose rows would
 * linger in the shared one (the audit log is append-only) or that need a clean slate.
 */
export async function scratchDatabase(
  prefix: string,
): Promise<{ url: string; drop(): Promise<void> }> {
  const { randomUUID } = await import("node:crypto");
  const pg = (await import("pg")).default;
  const { migrate } = await import("./migrate.js");
  const name = `${prefix}_${randomUUID().slice(0, 8)}`;
  const admin = async (statement: string) => {
    const client = new pg.Client({ connectionString: TEST_DATABASES.live });
    await client.connect();
    try {
      await client.query(statement);
    } finally {
      await client.end();
    }
  };
  await admin(`create database ${name}`);
  const url = Object.assign(new URL(TEST_DATABASES.live), { pathname: `/${name}` }).toString();
  await migrate(url);
  return { url, drop: () => admin(`drop database ${name} with (force)`) };
}
