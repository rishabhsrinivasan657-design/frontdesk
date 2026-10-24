import { asc, desc, eq } from "drizzle-orm";
import { type SQL, sql } from "drizzle-orm";
import type { AuditRow } from "../audit-log.js";
import type { Db } from "../client.js";
import type { TurnRecord } from "../conversations.js";
import { auditLog, handoffs, turns } from "../schema.js";
import { iso } from "../time.js";
import { type HandoffRow, toHandoffRow } from "./handoffs.js";
import { type OwnerSource, containsPattern, isoOf, isoOrNullOf, rows, sourceIs } from "./shared.js";

export interface ConversationSummary {
  id: string;
  source: OwnerSource;
  seeded: boolean;
  startedAt: string;
  endedAt: string | null;
  outcome: string | null;
  handoffReason: string | null;
  turnCount: number;
  lastCallerText: string | null;
  /** At least one write reached Calendar (an `executed` audit row). */
  booked: boolean;
  costUsd: number;
}

export interface ConversationDetail {
  summary: ConversationSummary;
  turns: TurnRecord[];
  audit: AuditRow[];
  handoff: HandoffRow | null;
}

interface SummaryRow {
  id: string;
  source: OwnerSource;
  seeded: boolean;
  started_at: Date;
  ended_at: Date | null;
  outcome: string | null;
  handoff_reason: string | null;
  turn_count: number;
  last_caller_text: string | null;
  booked: boolean;
  cost_usd: number;
}

function summaries(db: Db, where: SQL, limit: number): Promise<SummaryRow[]> {
  return rows<SummaryRow>(
    db,
    sql`select c.id, c.source, c.seeded, c.started_at, c.ended_at, c.outcome, c.handoff_reason,
      (select count(*) from turns t where t.conversation_id = c.id)::int as turn_count,
      (select t.caller_text from turns t where t.conversation_id = c.id
        order by t.turn_index desc limit 1) as last_caller_text,
      exists (select 1 from audit_log a where a.session_id = c.id and a.stage = 'executed') as booked,
      coalesce((select sum(t.cost_usd) from turns t where t.conversation_id = c.id), 0)::float8
        as cost_usd
    from conversations c
    where ${where}
    order by c.started_at desc, c.id desc
    limit ${limit}`,
  );
}

const toSummary = (r: SummaryRow): ConversationSummary => ({
  id: r.id,
  source: r.source,
  seeded: r.seeded,
  startedAt: isoOf(r.started_at),
  endedAt: isoOrNullOf(r.ended_at),
  outcome: r.outcome,
  handoffReason: r.handoff_reason,
  turnCount: r.turn_count,
  lastCallerText: r.last_caller_text,
  booked: r.booked,
  costUsd: r.cost_usd,
});

/** Newest first. `q` matches the id or any caller/agent line, literally; `before` pages back. */
export async function listConversations(
  db: Db,
  o: { source: OwnerSource; q?: string; before?: string; limit?: number },
): Promise<ConversationSummary[]> {
  const where: SQL[] = [sourceIs(o.source)];
  if (o.before) where.push(sql`c.started_at < ${o.before}`);
  const q = o.q?.trim();
  if (q) {
    const p = containsPattern(q);
    where.push(sql`(c.id ilike ${p} or exists (select 1 from turns t where t.conversation_id = c.id
      and (t.caller_text ilike ${p} or t.agent_text ilike ${p})))`);
  }
  const found = await summaries(db, sql.join(where, sql` and `), o.limit ?? 50);
  return found.map(toSummary);
}

/** One conversation with everything the owner needs to review it; null for eval or unknown ids. */
export async function getConversation(db: Db, id: string): Promise<ConversationDetail | null> {
  const [summary] = await summaries(db, sql`c.id = ${id} and c.source in ('live', 'pilot')`, 1);
  if (!summary) return null;
  const [turnRows, auditRows, handoffRows] = await Promise.all([
    db.select().from(turns).where(eq(turns.conversationId, id)).orderBy(asc(turns.turnIndex)),
    db.select().from(auditLog).where(eq(auditLog.sessionId, id)).orderBy(asc(auditLog.seq)),
    db
      .select()
      .from(handoffs)
      .where(eq(handoffs.sessionId, id))
      .orderBy(desc(handoffs.createdAt))
      .limit(1),
  ]);
  const handoff = handoffRows[0];
  return {
    summary: toSummary(summary),
    turns: turnRows.map((t) => ({ ...t, createdAt: iso(t.createdAt) })),
    audit: auditRows.map((a) => ({ ...a, at: iso(a.at) }) as AuditRow),
    handoff: handoff
      ? toHandoffRow({ ...handoff, source: summary.source, seeded: summary.seeded })
      : null,
  };
}
