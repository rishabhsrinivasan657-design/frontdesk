export {
  CONFIRMATION_QUEUE,
  type ConfirmationJob,
  type ConfirmationQueue,
  EMAIL_ATTEMPTS,
  EMAIL_BACKOFF,
  type EnqueueOptions,
  enqueueConfirmation,
  parseConfirmationJob,
  QueueMailer,
} from "./confirmation-job.js";
export {
  type EmailAttemptLog,
  type ProcessDeps,
  processConfirmation,
} from "./process-confirmation.js";
export { createConfirmationQueue, startConfirmationWorker } from "./worker.js";
