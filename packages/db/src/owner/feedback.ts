import { sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { type OwnerSource, isoOf, rows, sourceIs } from "./shared.js";

export interface FeedbackRow {
  conversationId: string;
  rating: number | null;
  comment: string;
  createdAt: string;
  seeded: boolean;
}

/** Post-conversation ratings for one source, newest first (spec §12). */
export async function listFeedback(
  db: Db,
  o: { source: OwnerSource; limit: number },
): Promise<FeedbackRow[]> {
  const found = await rows<{
    conversation_id: string;
    rating: number | null;
    comment: string;
    created_at: Date;
    seeded: boolean;
  }>(
    db,
    sql`select f.conversation_id, f.rating, f.comment, f.created_at, c.seeded
    from feedback f join conversations c on c.id = f.conversation_id
    where ${sourceIs(o.source)}
    order by f.created_at desc, f.id
    limit ${o.limit}`,
  );
  return found.map((r) => ({
    conversationId: r.conversation_id,
    rating: r.rating,
    comment: r.comment,
    createdAt: isoOf(r.created_at),
    seeded: r.seeded,
  }));
}
