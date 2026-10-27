import type { Clock } from "@frontdesk/core";
import { Queue, Worker } from "bullmq";

/** Pilot personal data is kept this long (M10, shown on /privacy). */
export const RETENTION_DAYS = 30;
export const RETENTION_QUEUE = "retention";

export interface RetentionDeps {
  clock: Clock;
  purge(o: { before: Date; now: Date }): Promise<{ conversations: number }>;
  /** The demo calendar's old bookings; absent without Google credentials. */
  redactCalendar?: (before: Date) => Promise<number>;
  log(line: string): void;
}

/** One retention pass: everything that started (or ended) before now − 30 days. Counts only. */
export async function runRetention(
  deps: RetentionDeps,
): Promise<{ conversations: number; calendarEvents: number }> {
  const now = deps.clock.now();
  const before = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const { conversations } = await deps.purge({ before, now });
  const calendarEvents = deps.redactCalendar ? await deps.redactCalendar(before) : 0;
  deps.log(`retention: ${conversations} conversations, ${calendarEvents} calendar events redacted`);
  return { conversations, calendarEvents };
}

const connect = (url: string) => ({ url, maxRetriesPerRequest: null });

/** Runs `runRetention` every day at 04:00 New York, plus once at start-up. */
export async function startRetentionSchedule(opts: {
  redisUrl: string;
  deps: RetentionDeps;
}): Promise<{ close(): Promise<void> }> {
  const queue = new Queue(RETENTION_QUEUE, { connection: connect(opts.redisUrl) });
  await queue.upsertJobScheduler(
    "daily",
    { pattern: "0 4 * * *", tz: "America/New_York" },
    { name: "retention" },
  );
  await queue.add("retention", {}, { removeOnComplete: true, removeOnFail: 50 });
  const worker = new Worker(RETENTION_QUEUE, () => runRetention(opts.deps), {
    connection: connect(opts.redisUrl),
  });
  worker.on("error", (error) => console.error(`retention worker error: ${error.message}`));
  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
