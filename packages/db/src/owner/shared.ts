import { type SQL, sql } from "drizzle-orm";
import type { Db } from "../client.js";

/** What the owner can see. `eval` lives only in the eval database (spec §10). */
export type OwnerSource = "live" | "pilot";

/**
 * The source filter on conversation alias `c`. Seeded demo rows are only ever `live`, and
 * pilot numbers exclude them again in case one is ever mislabelled.
 */
export function sourceIs(source: OwnerSource): SQL {
  return source === "pilot" ? sql`c.source = 'pilot' and not c.seeded` : sql`c.source = 'live'`;
}

/** ILIKE pattern for a literal substring: `%`, `_` and `\` match themselves. */
export function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** Raw SQL rows; timestamps come back as Date, numerics as strings unless cast. */
export async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

export const isoOf = (v: Date | string): string => new Date(v).toISOString();
export const isoOrNullOf = (v: Date | string | null): string | null => (v ? isoOf(v) : null);
