import { describe, expect, it } from "vitest";
import {
  type ConfirmationJob,
  type ConfirmationQueue,
  enqueueConfirmation,
  QueueMailer,
} from "./confirmation-job.js";
import { email } from "./fixtures.js";

class FakeQueue implements ConfirmationQueue {
  readonly added: { name: string; data: ConfirmationJob; opts: unknown }[] = [];
  add(name: string, data: ConfirmationJob, opts: unknown): Promise<unknown> {
    this.added.push({ name, data, opts });
    return Promise.resolve();
  }
}

describe("enqueueConfirmation", () => {
  it("uses the action id as job id with 5 attempts and exponential backoff", async () => {
    const queue = new FakeQueue();
    await enqueueConfirmation(queue, email);
    expect(queue.added).toEqual([
      {
        name: "confirmation-email",
        data: { email },
        opts: {
          jobId: "confirm-act_1",
          attempts: 5,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
    ]);
  });

  it("QueueMailer enqueues instead of sending", async () => {
    const queue = new FakeQueue();
    await new QueueMailer(queue).sendConfirmation(email);
    expect(queue.added).toHaveLength(1);
  });
});
