import { InMemoryHandoffQueue, ManualClock } from "@frontdesk/core";
import { describe, expect, it, vi } from "vitest";
import { MemoryEmailQuota } from "./email-quota.js";
import { email, MemoryAttemptLog, ScriptedMailer } from "./fixtures.js";
import { type ProcessDeps, processConfirmation } from "./process-confirmation.js";

const asJob = () => JSON.parse(JSON.stringify({ email })) as unknown;

function setup(outcomes: boolean[] = []) {
  const mailer = new ScriptedMailer(outcomes);
  const attempts = new MemoryAttemptLog();
  const handoffs = new InMemoryHandoffQueue();
  const deps: ProcessDeps = {
    mailer,
    attempts,
    handoffs,
    clock: new ManualClock(new Date("2026-11-06T23:00:00.000Z")),
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
        id: "handoff_email_act_1",
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

  it("retries a failed handoff enqueue so the final failure still reaches a human", async () => {
    const { handoffs, deps } = setup([false]);
    const enqueue = handoffs.enqueue.bind(handoffs);
    let calls = 0;
    deps.handoffs = {
      enqueue: (t) => (++calls < 3 ? Promise.reject(new Error("db down")) : enqueue(t)),
    };
    await expect(processConfirmation(asJob(), { made: 4, max: 5 }, deps)).rejects.toThrow(
      /smtp 503/,
    );
    expect(handoffs.tickets.map((t) => t.id)).toEqual(["handoff_email_act_1"]);
  });

  it("still rethrows the send error when the handoff can't be saved at all", async () => {
    const { deps } = setup([false]);
    deps.handoffs = { enqueue: () => Promise.reject(new Error("db down")) };
    await expect(processConfirmation(asJob(), { made: 4, max: 5 }, deps)).rejects.toThrow(
      /smtp 503/,
    );
  });

  it("redacts tokens and caps the error before it is audited", async () => {
    const { attempts, deps } = setup();
    deps.mailer = {
      sendConfirmation: () =>
        Promise.reject(
          new Error(`401 Authorization: Bearer ya29.SECRET refresh 1//0gSECRET ${"x".repeat(500)}`),
        ),
    };
    await expect(processConfirmation(asJob(), { made: 0, max: 5 }, deps)).rejects.toThrow();
    const error = attempts.attempts[0]!.error!;
    expect(error).not.toMatch(/SECRET/);
    expect(error).toContain("[redacted]");
    expect(error.length).toBeLessThanOrEqual(300);
  });
});

describe("daily email caps (M10)", () => {
  it("4th email to one recipient today is skipped and audited daily_cap", async () => {
    const { mailer, attempts, handoffs, deps } = setup();
    deps.quota = new MemoryEmailQuota({ perRecipient: 3, global: 50 });
    for (let i = 0; i < 4; i++) await processConfirmation(asJob(), { made: 0, max: 5 }, deps);
    expect(mailer.sent).toHaveLength(3);
    expect(attempts.attempts.at(-1)).toMatchObject({ ok: false, error: "daily_cap", attempt: 1 });
    expect(handoffs.tickets).toEqual([]);
  });

  it("51st email overall is skipped, without throwing so it is never retried", async () => {
    const { mailer, deps } = setup();
    deps.quota = new MemoryEmailQuota({ perRecipient: 100, global: 50 });
    for (let i = 0; i < 50; i++) await processConfirmation(asJob(), { made: 0, max: 5 }, deps);
    await expect(processConfirmation(asJob(), { made: 0, max: 5 }, deps)).resolves.toBeUndefined();
    expect(mailer.sent).toHaveLength(50);
  });

  it("a retry doesn't count against the caps again", async () => {
    const { mailer, deps } = setup([false, true]);
    deps.quota = new MemoryEmailQuota({ perRecipient: 1, global: 50 });
    await expect(processConfirmation(asJob(), { made: 0, max: 5 }, deps)).rejects.toThrow();
    await processConfirmation(asJob(), { made: 1, max: 5 }, deps);
    expect(mailer.sent).toHaveLength(1);
  });
});

describe("logs carry no personal data (M10)", () => {
  it("a lost handoff and a failed audit log neither names, addresses nor session ids", async () => {
    const { deps } = setup([false]);
    const leak = new Error("insert failed\nparams: Ana Ruiz,ana@example.com,s1");
    deps.handoffs = { enqueue: () => Promise.reject(leak) };
    deps.attempts = { recordEmailAttempt: () => Promise.reject(leak) };
    const logged: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((m: unknown) => void logged.push(String(m)));
    try {
      await expect(processConfirmation(asJob(), { made: 4, max: 5 }, deps)).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(logged.length).toBeGreaterThan(0);
    const out = logged.join("\n");
    for (const pii of ["Ana", "ana@example.com", "s1", "params"]) expect(out).not.toContain(pii);
  });
});
