import type { Clock, HandoffQueue, IdGenerator, Mailer } from "@frontdesk/core";
import type { EmailAttempt } from "@frontdesk/db";
import { parseConfirmationJob } from "./confirmation-job.js";

/** Where each send attempt is audited; `PgAuditLog` satisfies it. */
export interface EmailAttemptLog {
  recordEmailAttempt(attempt: EmailAttempt): Promise<void>;
}

export interface ProcessDeps {
  mailer: Mailer;
  attempts: EmailAttemptLog;
  handoffs: HandoffQueue;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * Runs one attempt of a confirmation-email job. `attempt.made` is how many attempts
 * came before this one. A failure is audited and rethrown so BullMQ retries it; the
 * final failure also opens a handoff. The booking itself always stands (spec §11).
 */
export async function processConfirmation(
  data: unknown,
  attempt: { made: number; max: number },
  deps: ProcessDeps,
): Promise<void> {
  const email = parseConfirmationJob(data);
  // An audit write that fails must not change the job's outcome: failing a sent email
  // would make BullMQ send it again, and it must never hide a send failure.
  const record = (ok: boolean, error?: string) =>
    deps.attempts
      .recordEmailAttempt({
        at: deps.clock.now().toISOString(),
        sessionId: email.sessionId,
        actionId: email.actionId,
        kind: email.kind,
        ok,
        attempt: attempt.made + 1,
        ...(error === undefined ? {} : { error }),
      })
      .catch((auditError: unknown) => {
        const why = auditError instanceof Error ? auditError.message : String(auditError);
        console.error(`audit of email attempt for ${email.actionId} failed: ${why}`);
      });

  try {
    await deps.mailer.sendConfirmation(email);
  } catch (error) {
    await record(false, error instanceof Error ? error.message : String(error));
    if (attempt.made + 1 >= attempt.max) {
      await deps.handoffs.enqueue({
        id: deps.ids("handoff"),
        sessionId: email.sessionId,
        reason: "email_failed",
        summary: `Confirmation email to ${email.to} failed after ${attempt.max} attempts; the ${email.kind} for ${email.booking.name} at ${email.booking.start.toISOString()} stands.`,
        transcript: [],
        createdAt: deps.clock.now().toISOString(),
      });
    }
    throw error;
  }
  await record(true);
}
