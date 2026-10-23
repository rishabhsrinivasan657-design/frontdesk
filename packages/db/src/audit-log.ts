import type { ActionKind, AuditEvent, AuditLog, AuditStage } from "@frontdesk/core";
import { asc, eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { auditLog } from "./schema.js";
import { iso } from "./time.js";

/** One confirmation-email send attempt by the worker (spec §11: each attempt is audited). */
export interface EmailAttempt {
  at: string;
  sessionId: string;
  actionId: string;
  kind: ActionKind;
  ok: boolean;
  /** 1-based. */
  attempt: number;
  error?: string;
}

export interface AuditRow {
  seq: number;
  at: string;
  sessionId: string;
  turnId: string | null;
  actionId: string;
  kind: ActionKind;
  stage: AuditStage | "email_sent" | "email_failed";
  args: unknown;
  result: unknown;
  reason: string | null;
}

/** Postgres audit log. Only ever INSERTs; the table's triggers reject anything else (spec §6). */
export class PgAuditLog implements AuditLog {
  constructor(private readonly db: Db) {}

  async append(event: AuditEvent): Promise<void> {
    await this.db.insert(auditLog).values({
      at: event.at,
      sessionId: event.sessionId,
      turnId: event.turnId,
      actionId: event.actionId,
      kind: event.kind,
      stage: event.stage,
      args: event.args,
      result: event.result ?? null,
      reason: event.reason ?? null,
    });
  }

  async recordEmailAttempt(a: EmailAttempt): Promise<void> {
    await this.db.insert(auditLog).values({
      at: a.at,
      sessionId: a.sessionId,
      actionId: a.actionId,
      kind: a.kind,
      stage: a.ok ? "email_sent" : "email_failed",
      result: { attempt: a.attempt },
      reason: a.error ?? null,
    });
  }

  async forAction(actionId: string): Promise<AuditRow[]> {
    const rows = await this.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.actionId, actionId))
      .orderBy(asc(auditLog.seq));
    return rows.map((r) => ({
      ...r,
      at: iso(r.at),
      kind: r.kind as ActionKind,
      stage: r.stage as AuditRow["stage"],
    }));
  }
}
