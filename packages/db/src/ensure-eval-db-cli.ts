import pg from "pg";

/**
 * Render (docs/deploy-render.md) gives one free Postgres, so the eval database is created beside
 * the live one before migrations run. Prints database names only: the URLs hold a password.
 */
const url = process.env.DATABASE_URL;
const evalUrl = process.env.EVAL_DATABASE_URL;
if (!url || !evalUrl) throw new Error("DATABASE_URL and EVAL_DATABASE_URL must both be set");

const name = new URL(evalUrl).pathname.slice(1);
// CREATE DATABASE can't take a bound parameter, so only a plain identifier is accepted.
if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("EVAL_DATABASE_URL has an unusual name");

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
await client.connect();
try {
  const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (found.rowCount === 0) {
    await client.query(`CREATE DATABASE ${name}`);
    console.log(`created ${name}`);
  }
} finally {
  await client.end();
}
