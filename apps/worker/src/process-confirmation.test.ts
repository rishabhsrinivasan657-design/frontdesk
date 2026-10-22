import { InMemoryHandoffQueue, ManualClock, sequentialIds } from "@frontdesk/core";
import { describe, expect, it } from "vitest";
import { email, MemoryAttemptLog, ScriptedMailer } from "./fixtures.js";
import { processConfirmation } from "./process-confirmation.js";

const asJob = () => JSON.parse(JSON.stringify({ email })) as unknown;

function setup(outcomes: boolean[] = []) {
  const mailer = new ScriptedMailer(outcomes);
  const attempts = new MemoryAttemptLog();
  const handoffs = new InMemoryHandoffQueue();
  const deps = {
    mailer,
    attempts,
    handoffs,
    clock: new ManualClock(new Date("2026-11-06T23:00:00.000Z")),
    ids: sequentialIds(),
  };
  return { mailer, attempts, handoffs, deps };
}

describe("processConfirmation", () => {
  it("sends and records attempt 1 as ok", async () => {
    const { mailer, attempts, deps } = setup();
    await processConfirmation(asJob(), { made: 0, max: 5 }, deps);
    expect(mailer.sent).toHaveLength(1);
    expect(attempts.attempts).toEqual([
      {
        at: "2026-11-06T23:00:00.000Z",
        sessionId: "s1",
        actionId: "act_1",
        kind: "book",
        ok: true,
        attempt: 1,
      },
    ]);
  });

  it("revives booking dates before sending", async () => {
    const { mailer, deps } = setup();
    await processConfirmation(asJob(), { made: 0, max: 5 }, deps);
    expect(mailer.sent[0]!.booking.start).toBeInstanceOf(Date);
    expect(mailer.sent[0]).toEqual(email);
  });

  it("records a failed attempt and rethrows", async () => {
    const { attempts, handoffs, deps } = setup([false]);
    await expect(processConfirmation(asJob(), { made: 1, max: 5 }, deps)).rejects.toThrow(
      /smtp 503/,
    );
    expect(attempts.attempts).toMatchObject([
      { ok: false, attempt: 2, error: "smtp 503 on call 1" },
    ]);
    expect(handoffs.tickets).toEqual([]);
  });

  it("hands off only on the final attempt", async () => {
    const { handoffs, deps } = setup([false, false]);
    await expect(processConfirmation(asJob(), { made: 3, max: 5 }, deps)).rejects.toThrow();
    expect(handoffs.tickets).toEqual([]);
    await expect(processConfirmation(asJob(), { made: 4, max: 5 }, deps)).rejects.toThrow();
    expect(handoffs.tickets).toEqual([
      {
        id: "handoff_1",
        sessionId: "s1",
        reason: "email_failed",
        summary:
          "Confirmation email to ana@example.com failed after 5 attempts; the book for Ana Ruiz at 2026-11-07T00:00:00.000Z stands.",
        transcript: [],
        createdAt: "2026-11-06T23:00:00.000Z",
      },
    ]);
  });

  it("rejects malformed job data without sending", async () => {
    const { mailer, attempts, deps } = setup();
    await expect(
      processConfirmation(
        { email: { ...email, booking: { start: "soon" } } },
        { made: 0, max: 5 },
        deps,
      ),
    ).rejects.toThrow();
    expect(mailer.calls).toBe(0);
    expect(attempts.attempts).toEqual([]);
  });

  it("does not fail (and so never re-sends) when auditing a successful send fails", async () => {
    const { mailer, deps } = setup();
    deps.attempts.recordEmailAttempt = () => Promise.reject(new Error("db down"));
    await processConfirmation(asJob(), { made: 0, max: 5 }, deps);
    expect(mailer.sent).toHaveLength(1);
  });

  it("rethrows the send error, and still hands off, when auditing a failure fails", async () => {
    const { handoffs, deps } = setup([false]);
    deps.attempts.recordEmailAttempt = () => Promise.reject(new Error("db down"));
    await expect(processConfirmation(asJob(), { made: 4, max: 5 }, deps)).rejects.toThrow(
      /smtp 503/,
    );
    expect(handoffs.tickets).toHaveLength(1);
  });
});
