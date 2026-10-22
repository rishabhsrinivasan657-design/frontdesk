import type { ConfirmationEmail, Mailer } from "@frontdesk/core";
import type { EmailAttempt } from "@frontdesk/db";
import type { EmailAttemptLog } from "./process-confirmation.js";

export const email: ConfirmationEmail = {
  kind: "book",
  to: "ana@example.com",
  businessName: "Casa Fiorella",
  sessionId: "s1",
  actionId: "act_1",
  booking: {
    id: "res_1",
    start: new Date("2026-11-07T00:00:00.000Z"),
    end: new Date("2026-11-07T01:30:00.000Z"),
    tableId: "t4-1",
    partySize: 4,
    name: "Ana Ruiz",
    contact: "ana@example.com",
    notes: "",
  },
};

/** Records attempts in memory. */
export class MemoryAttemptLog implements EmailAttemptLog {
  readonly attempts: EmailAttempt[] = [];
  recordEmailAttempt(a: EmailAttempt): Promise<void> {
    this.attempts.push(a);
    return Promise.resolve();
  }
}

/** Fails while `outcomes` says false, then succeeds; counts calls and keeps what it sent. */
export class ScriptedMailer implements Mailer {
  readonly sent: ConfirmationEmail[] = [];
  calls = 0;
  constructor(private readonly outcomes: boolean[] = []) {}
  sendConfirmation(e: ConfirmationEmail): Promise<void> {
    const ok = this.outcomes[this.calls++] ?? true;
    if (!ok) return Promise.reject(new Error(`smtp 503 on call ${this.calls}`));
    this.sent.push(e);
    return Promise.resolve();
  }
}
