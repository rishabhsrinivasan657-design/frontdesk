import type { Clock, HandoffQueue, HandoffTicket, Mailer } from "@frontdesk/core";
import type { EmailAttempt } from "@frontdesk/db";
import { parseConfirmationJob } from "./confirmation-job.js";
import type { EmailQuota } from "./email-quota.js";

/** Where each send attempt is audited; `PgAuditLog` satisfies it. */
export interface EmailAttemptLog {
  recordEmailAttempt(attempt: EmailAttempt): Promise<void>;
}

export interface ProcessDeps {
  mailer: Mailer;
  attempts: EmailAttemptLog;
  handoffs: HandoffQueue;
  clock: Clock;
  /** Daily email caps (M10); none when undefined. */
  quota?: EmailQuota;
}

/** Saving the final handoff is retried this many times (1 s, 2 s apart) before giving up loudly. */
const HANDOFF_TRIES = 3;
const MAX_ERROR_CHARS = 300;

/**
 * audit_log can never be cleaned up, so a token must never reach it. Adapters are meant
 * to throw sanitized errors already (part B); this is the second line of defense.
 */
export function redactError(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bya29\.\S+/g, "[redacted]")
    .replace(/\b1\/\/\S+/g, "[redacted]")
    .slice(0, MAX_ERROR_CHARS);
}

/** An error's message for a log line, minus the query parameters (names, emails) Drizzle appends. */
function safeWhy(error: unknown): string {
  const message = error instanceof Error ? error.message : "non-error thrown";
  return redactError(message.split(/\n\s*params:/)[0]!);
}

async function saveHandoff(deps: ProcessDeps, ticket: HandoffTicket): Promise<void> {
  for (let tryNo = 1; ; tryNo++) {
    try {
      await deps.handoffs.enqueue(ticket);
      return;
    } catch (error) {
      if (tryNo >= HANDOFF_TRIES) {
        // The ticket id names the action, not the caller; the summary holds personal data.
        console.error(`HANDOFF LOST: ${ticket.id} (${safeWhy(error)})`);
        return;
      }
      await deps.clock.sleep(1000 * 2 ** (tryNo - 1));
    }
  }
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
        console.error(
          `audit of email attempt for ${email.actionId} failed: ${safeWhy(auditError)}`,
        );
      });

  // Counted once per email, on its first attempt; retries are the same email.
  if (deps.quota && attempt.made === 0) {
    const day = deps.clock.now().toISOString().slice(0, 10);
    if ((await deps.quota.take(email.to, day)) !== "ok") {
      // Skipped for good: no retry, no handoff. The booking itself stands (spec §11).
      await record(false, "daily_cap");
      return;
    }
  }

  try {
    await deps.mailer.sendConfirmation(email);
  } catch (error) {
    await record(false, redactError(error instanceof Error ? error.message : String(error)));
    if (attempt.made + 1 >= attempt.max) {
      // A fixed id per action: if this final attempt is re-run (worker crash), no second ticket.
      await saveHandoff(deps, {
        id: `handoff_email_${email.actionId}`,
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
