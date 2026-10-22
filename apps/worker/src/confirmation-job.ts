import type { ConfirmationEmail, Mailer } from "@frontdesk/core";
import type { JobsOptions } from "bullmq";
import { z } from "zod";

export const CONFIRMATION_QUEUE = "confirmation-email";
/** Gmail send fails → retry with backoff, 5 attempts (spec §11). */
export const EMAIL_ATTEMPTS = 5;
/** 2 s, 4 s, 8 s, 16 s between the 5 attempts. */
export const EMAIL_BACKOFF = { type: "exponential", delay: 2000 } as const;

export interface ConfirmationJob {
  email: ConfirmationEmail;
}

/** The slice of a BullMQ `Queue` the enqueue path needs; a real `Queue` satisfies it. */
export interface ConfirmationQueue {
  add(name: string, data: ConfirmationJob, opts: JobsOptions): Promise<unknown>;
}

const isoDate = z.iso.datetime().transform((s) => new Date(s));

const confirmationEmail = z.object({
  kind: z.enum(["book", "reschedule", "cancel"]),
  to: z.string().min(1),
  businessName: z.string(),
  sessionId: z.string().min(1),
  actionId: z.string().min(1),
  booking: z.object({
    id: z.string(),
    start: isoDate,
    end: isoDate,
    tableId: z.string(),
    partySize: z.number().int().positive(),
    name: z.string(),
    contact: z.string(),
    notes: z.string(),
  }),
});

/** Job data arrives as JSON from Redis: validate it and turn the booking's ISO strings back into Dates. */
export function parseConfirmationJob(data: unknown): ConfirmationEmail {
  return z.object({ email: confirmationEmail }).parse(data).email;
}

/** How long a sent job's id is kept, so a duplicate enqueue for the same action is ignored. */
export const DEDUPE_WINDOW_S = 86_400;

export interface EnqueueOptions {
  /** Overrides the backoff base delay. Tests only. */
  backoffDelayMs?: number;
}

/**
 * Queues one confirmation email. The job id is the action id, so a second enqueue
 * for the same action (a retried request, a duplicate "yes") adds nothing.
 */
export async function enqueueConfirmation(
  queue: ConfirmationQueue,
  email: ConfirmationEmail,
  opts: EnqueueOptions = {},
): Promise<void> {
  await queue.add(
    CONFIRMATION_QUEUE,
    { email },
    {
      jobId: `confirm-${email.actionId}`,
      attempts: EMAIL_ATTEMPTS,
      backoff: { ...EMAIL_BACKOFF, delay: opts.backoffDelayMs ?? EMAIL_BACKOFF.delay },
      removeOnComplete: { age: DEDUPE_WINDOW_S },
      // Failed jobs stay for inspection; their handoff ticket is the follow-up.
      removeOnFail: false,
    },
  );
}

/** The `Mailer` the api gives the gate: "sending" means queueing for the worker. */
export class QueueMailer implements Mailer {
  constructor(
    private readonly queue: ConfirmationQueue,
    private readonly opts: EnqueueOptions = {},
  ) {}

  sendConfirmation(email: ConfirmationEmail): Promise<void> {
    return enqueueConfirmation(this.queue, email, this.opts);
  }
}
