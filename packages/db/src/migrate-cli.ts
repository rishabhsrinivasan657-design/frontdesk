import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config, parse } from "dotenv";
import { migrate } from "./migrate.js";

const root = resolve(import.meta.dirname, "../../..");
config({ path: resolve(root, ".env"), quiet: true });
const defaults = parse(readFileSync(resolve(root, ".env.example")));

// Live and eval data never mix, so both databases get the same schema (spec §10).
for (const key of ["DATABASE_URL", "EVAL_DATABASE_URL"]) {
  const url = process.env[key] ?? defaults[key];
  if (!url) throw new Error(`${key} is not set; add it to .env (see .env.example)`);
  await migrate(url);
  // Print the database name only: the URL holds a password.
  console.log(`migrated ${new URL(url).pathname.slice(1)}`);
}
