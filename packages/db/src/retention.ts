import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { auditLog, conversations, feedback, handoffs, turns } from "./schema.js";

export const REDACTED = "[redacted]";
/** JSON keys that hold what a caller told us about themselves. */
const PII_KEYS = new Set(["name", "contact", "notes", "to", "email", "phone"]);

/** A copy of `value` with every PII key's value replaced, at any depth. */
export function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, PII_KEYS.has(k) ? REDACTED : redactJson(v)]),
    );
  }
  return value;
}

/** Free text (an email error) minus addresses and phone numbers. */
export function redactText(text: string): string {
  return text
    .replace(/[^\s@<>()"']+@[^\s@<>()"']+/g, REDACTED)
    .replace(/\+?\d[\d\s().-]{5,}\d/g, REDACTED);
}

/**
 * Pilot retention (M10, docs/pilot.md): personal data in pilot conversations that started before
 * `before` is redacted, not deleted, so counts, outcomes, ratings and latencies still add up.
 * Live and seeded rows are never touched. Safe to re-run: purged conversations are skipped.
 */
export async function purgePilotPii(
  db: Db,
  o: { before: Date; now: Date },
): Promise<{ conversations: number }> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.source, "pilot"),
          eq(conversations.seeded, false),
          lt(conversations.startedAt, o.before.toISOString()),
          isNull(conversations.piiPurgedAt),
        ),
      );
    const ids = due.map((d) => d.id);
    if (ids.length === 0) return { conversations: 0 };

    await tx
      .update(turns)
      .set({ callerText: REDACTED, agentText: REDACTED })
      .where(inArray(turns.conversationId, ids));
    await tx
      .update(handoffs)
      .set({
        summary: REDACTED,
        transcript: [],
        notes: sql`case when ${handoffs.notes} is null then null else ${REDACTED} end`,
      })
      .where(inArray(handoffs.sessionId, ids));
    await tx.update(feedback).set({ comment: "" }).where(inArray(feedback.conversationId, ids));

    // audit_log accepts this one UPDATE only with the flag, and only to args/result/reason.
    await tx.execute(sql`set local frontdesk.retention = 'on'`);
    const audit = await tx
      .select({
        seq: auditLog.seq,
        args: auditLog.args,
        result: auditLog.result,
        reason: auditLog.reason,
      })
      .from(auditLog)
      .where(inArray(auditLog.sessionId, ids));
    for (const row of audit) {
      await tx
        .update(auditLog)
        .set({
          args: redactJson(row.args),
          result: redactJson(row.result),
          reason: row.reason === null ? null : redactText(row.reason),
        })
        .where(eq(auditLog.seq, row.seq));
    }

    await tx
      .update(conversations)
      .set({ piiPurgedAt: o.now.toISOString() })
      .where(inArray(conversations.id, ids));
    return { conversations: ids.length };
  });
}
