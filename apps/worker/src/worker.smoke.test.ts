import { randomUUID } from "node:crypto";
import { InMemoryHandoffQueue, ManualClock, sequentialIds } from "@frontdesk/core";
import { afterEach, describe, expect, it } from "vitest";
import { enqueueConfirmation } from "./confirmation-job.js";
import { email, MemoryAttemptLog, ScriptedMailer } from "./fixtures.js";
import { createConfirmationQueue, startConfirmationWorker } from "./worker.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:63790";
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function setup(outcomes: boolean[] = []) {
  const prefix = `fdtest-${randomUUID()}`;
  const mailer = new ScriptedMailer(outcomes);
  const attempts = new MemoryAttemptLog();
  const handoffs = new InMemoryHandoffQueue();
  const queue = createConfirmationQueue(redisUrl, prefix);
  const worker = startConfirmationWorker({
    redisUrl,
    prefix,
    deps: {
      mailer,
      attempts,
      handoffs,
      clock: new ManualClock(new Date("2026-11-06T23:00:00.000Z")),
      ids: sequentialIds(),
    },
  });
  closers.push(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });
  closers.push(() => worker.close());
  const enqueue = () => enqueueConfirmation(queue, email, { backoffDelayMs: 5 });
  return { mailer, attempts, handoffs, queue, enqueue };
}

describe("confirmation worker on Redis", () => {
  it("sends a queued confirmation once", async () => {
    const { mailer, attempts, enqueue } = setup();
    await enqueue();
    await until(() => attempts.attempts.length === 1);
    expect(mailer.sent).toHaveLength(1);
    expect(attempts.attempts[0]).toMatchObject({ ok: true, attempt: 1 });
  });

  it("five failures: five audited attempts, one handoff, no sixth try", async () => {
    const { mailer, attempts, handoffs, queue, enqueue } = setup([
      false,
      false,
      false,
      false,
      false,
    ]);
    await enqueue();
    await until(async () => (await queue.getJob("confirm-act_1"))?.finishedOn !== undefined);
    await new Promise((r) => setTimeout(r, 100)); // room for a wrongful sixth attempt
    expect(mailer.calls).toBe(5);
    expect(attempts.attempts.map((a) => [a.ok, a.attempt])).toEqual([
      [false, 1],
      [false, 2],
      [false, 3],
      [false, 4],
      [false, 5],
    ]);
    expect(handoffs.tickets.map((t) => t.reason)).toEqual(["email_failed"]);
    expect(await (await queue.getJob("confirm-act_1"))?.getState()).toBe("failed");
  });

  it("succeeds on the third attempt with no handoff", async () => {
    const { mailer, attempts, handoffs, enqueue } = setup([false, false, true]);
    await enqueue();
    await until(() => attempts.attempts.length === 3);
    expect(attempts.attempts.map((a) => a.ok)).toEqual([false, false, true]);
    expect(mailer.sent).toHaveLength(1);
    expect(handoffs.tickets).toEqual([]);
  });

  it("enqueueing the same action again after it was sent sends nothing", async () => {
    const { mailer, queue, enqueue } = setup();
    await enqueue();
    await until(async () => (await queue.getJobCountByTypes("waiting", "active", "delayed")) === 0);
    await enqueue(); // a late duplicate, after the first job completed
    await new Promise((r) => setTimeout(r, 100));
    expect(mailer.calls).toBe(1);
    expect(await queue.getJobCountByTypes("waiting", "delayed", "active")).toBe(0);
  });
});
