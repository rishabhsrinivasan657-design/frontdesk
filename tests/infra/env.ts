import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config, parse } from "dotenv";

const root = resolve(import.meta.dirname, "../..");

/** Infra URLs, resolved as: process env > .env > .env.example defaults. */
export function infraEnv(): { databaseUrl: string; evalDatabaseUrl: string; redisUrl: string } {
  config({ path: resolve(root, ".env"), quiet: true });
  const defaults = parse(readFileSync(resolve(root, ".env.example")));
  const get = (key: string) => process.env[key] ?? defaults[key] ?? "";
  return {
    databaseUrl: get("DATABASE_URL"),
    evalDatabaseUrl: get("EVAL_DATABASE_URL"),
    redisUrl: get("REDIS_URL"),
  };
}
