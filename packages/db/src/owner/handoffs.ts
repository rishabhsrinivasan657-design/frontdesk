import type { TranscriptEntry } from "@frontdesk/core";
import { sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { type OwnerSource, isoOf, isoOrNullOf, rows, sourceIs } from "./shared.js";

export interface HandoffRow {
  id: string;
  sessionId: string;
  source: OwnerSource;
  seeded: boolean;
  reason: string;
  summary: string;
  transcript: TranscriptEntry[];
  createdAt: string;
  resolvedAt: string | null;
  notes: string | null;
}

export function toHandoffRow(r: {
  id: string;
  sessionId: string;
  source: OwnerSource;
  seeded: boolean;
  reason: string;
  summary: string;
  transcript: unknown;
  createdAt: Date | string;
  resolvedAt: Date | string | null;
  notes: string | null;
}): HandoffRow {
  return {
    ...r,
    transcript: r.transcript as TranscriptEntry[],
    createdAt: isoOf(r.createdAt),
    resolvedAt: isoOrNullOf(r.resolvedAt),
  };
}

/**
 * The review queue: open tickets oldest first (who waited longest), resolved newest first.
 * A ticket whose conversation row is missing (its start failed) still shows, as `live`:
 * the api only ever writes live, and losing a caller is worse than a mislabel.
 */
export async function listHandoffs(
  db: Db,
  o: { source: OwnerSource; status: "open" | "resolved"; limit?: number },
): Promise<HandoffRow[]> {
  const open = o.status === "open";
  const found = await rows<{
    id: string;
    session_id: string;
    source: OwnerSource;
    seeded: boolean;
    reason: string;
    summary: string;
    transcript: unknown;
    created_at: Date;
    resolved_at: Date | null;
    notes: string | null;
  }>(
    db,
    sql`select * from (
      select h.id, h.session_id, coalesce(c.source, 'live') as source,
        coalesce(c.seeded, false) as seeded, h.reason, h.summary, h.transcript,
        h.created_at, h.resolved_at, h.notes
      from handoffs h left join conversations c on c.id = h.session_id
    ) c
    where ${sourceIs(o.source)} and ${open ? sql`c.resolved_at is null` : sql`c.resolved_at is not null`}
    order by ${open ? sql`c.created_at asc` : sql`c.resolved_at desc`}
    limit ${o.limit ?? 200}`,
  );
  return found.map((r) =>
    toHandoffRow({
      id: r.id,
      sessionId: r.session_id,
      source: r.source,
      seeded: r.seeded,
      reason: r.reason,
      summary: r.summary,
      transcript: r.transcript,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      notes: r.notes,
    }),
  );
}
