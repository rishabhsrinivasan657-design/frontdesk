import { Queue, Worker } from "bullmq";
import { CONFIRMATION_QUEUE, type ConfirmationJob, EMAIL_ATTEMPTS } from "./confirmation-job.js";
import { type ProcessDeps, processConfirmation } from "./process-confirmation.js";

/**
 * Connection options rather than a client, so BullMQ owns the connection and closes it
 * on `close()`. BullMQ needs `maxRetriesPerRequest: null` on connections it blocks on.
 */
const connect = (url: string) => ({ url, maxRetriesPerRequest: null });

/** The queue the api adds confirmation jobs to (via `enqueueConfirmation` or `QueueMailer`). */
export function createConfirmationQueue(redisUrl: string, prefix?: string) {
  return new Queue<ConfirmationJob>(CONFIRMATION_QUEUE, {
    connection: connect(redisUrl),
    ...(prefix === undefined ? {} : { prefix }),
  });
}

/** Processes confirmation jobs until closed. Retries and backoff come from the job's options. */
export function startConfirmationWorker(opts: {
  redisUrl: string;
  prefix?: string;
  deps: ProcessDeps;
}): { close(): Promise<void> } {
  const worker = new Worker<ConfirmationJob>(
    CONFIRMATION_QUEUE,
    (job) =>
      processConfirmation(
        job.data,
        { made: job.attemptsMade, max: job.opts.attempts ?? EMAIL_ATTEMPTS },
        opts.deps,
      ),
    {
      connection: connect(opts.redisUrl),
      ...(opts.prefix === undefined ? {} : { prefix: opts.prefix }),
    },
  );
  // Without a listener an emitted "error" would crash the process; BullMQ reconnects on its own.
  worker.on("error", (error) => console.error(`worker error: ${error.message}`));
  return { close: () => worker.close() };
}
