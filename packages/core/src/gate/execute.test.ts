import { describe, expect, it } from "vitest";
import { testConfig } from "../config/test-config.js";
import { ANA, agentFixture } from "../testing/agent-fixtures.js";
import { InMemoryBookingQuota } from "../adapters/memory/booking-quota.js";
import { confirmAndExecute, voidPending } from "./execute.js";
import { propose } from "./propose.js";

async function pendingBook(seed = [ANA]) {
  const fx = agentFixture(testConfig(), seed);
  const slotId = await fx.offer("2026-11-07", "19:00", 4);
  const result = await propose(fx.deps, fx.session, "turn_1", "book", {
    slotId,
    name: "Bo Chen",
    contact: "bo@example.com",
    partySize: 4,
    notes: "",
  });
  if (!result.ok) throw new Error(result.message);
  return { fx, action: result.action, slot: fx.session.offeredSlots[slotId]! };
}

const stages = (fx: ReturnType<typeof agentFixture>, actionId: string) =>
  fx.deps.audit
    .entries()
    .filter((e) => e.actionId === actionId)
    .map((e) => e.stage);

describe("confirmAndExecute", () => {
  it("executes a confirmed book exactly once, audits it and emails the caller", async () => {
    const { fx, action, slot } = await pendingBook();
    const outcome = await confirmAndExecute(fx.deps, "s1", action.id, "turn_2");
    expect(outcome).toMatchObject({ status: "executed" });
    expect(outcome.reply).toBe(
      "You're all set: a table for 4 on Saturday, November 7 at 7:00 PM under Bo Chen. A confirmation email is on its way.",
    );
    expect(fx.deps.calendar.writes.map((w) => w.op)).toEqual(["create"]);
    const created = await fx.deps.calendar.getReservation(fx.deps.calendar.writes[0]!.id);
    expect(created).toMatchObject({ tableId: slot.tableId, partySize: 4, name: "Bo Chen" });
    expect(stages(fx, action.id)).toEqual(["proposed", "confirmed", "executed"]);
    expect(fx.deps.mailer.sent).toHaveLength(1);
    expect(fx.deps.mailer.sent[0]).toMatchObject({
      kind: "book",
      to: "bo@example.com",
      sessionId: "s1",
      actionId: action.id,
    });
  });

  it("refuses a wrong action id", async () => {
    const { fx } = await pendingBook();
    expect(await confirmAndExecute(fx.deps, "s1", "act_999", "turn_2")).toMatchObject({
      status: "failed",
      reason: "not_pending",
    });
    expect(fx.deps.calendar.writes).toEqual([]);
  });

  it("executes only once when confirmed twice", async () => {
    const { fx, action } = await pendingBook();
    await confirmAndExecute(fx.deps, "s1", action.id, "turn_2");
    expect(await confirmAndExecute(fx.deps, "s1", action.id, "turn_3")).toMatchObject({
      status: "failed",
      reason: "not_pending",
    });
    expect(fx.deps.calendar.writes).toHaveLength(1);
  });

  it("refuses and voids an expired action", async () => {
    const { fx, action } = await pendingBook();
    fx.deps.clock.advance(300_001);
    const outcome = await confirmAndExecute(fx.deps, "s1", action.id, "turn_2");
    expect(outcome).toMatchObject({ status: "failed", reason: "not_pending" });
    expect(outcome.reply).toContain("timed out");
    expect(stages(fx, action.id)).toEqual(["proposed", "voided"]);
    expect(fx.deps.audit.entries().at(-1)!.reason).toBe("expired");
    expect(fx.deps.calendar.writes).toEqual([]);
  });

  it("fails with fresh alternatives when the slot was taken after the proposal", async () => {
    const { fx, action, slot } = await pendingBook();
    // Take every four-top at 19:00 so the same slot id can't come back.
    for (const tableId of ["t4-1", "t4-2", "t4-3", "t4-4", "t4-5", "t4-6"]) {
      await fx.deps.calendar.createReservation({
        start: new Date(slot.start),
        end: new Date(slot.end),
        tableId,
        partySize: 4,
        name: "Walk-in",
        contact: "w@example.com",
        notes: "",
      });
    }
    const writesBefore = fx.deps.calendar.writes.length;
    const outcome = await confirmAndExecute(fx.deps, "s1", action.id, "turn_2");
    expect(outcome).toMatchObject({ status: "failed", reason: "slot_taken" });
    expect(fx.deps.calendar.writes).toHaveLength(writesBefore);
    if (outcome.status !== "failed") throw new Error("expected failure");
    expect(outcome.alternatives!.length).toBeGreaterThan(0);
    expect(outcome.alternatives!.map((s) => s.id)).not.toContain(slot.id);
    expect(outcome.reply).toContain("just taken");
    expect(stages(fx, action.id)).toEqual(["proposed", "confirmed", "failed"]);
  });

  it("fails as slot_locked while another writer holds the slot", async () => {
    const { fx, action, slot } = await pendingBook();
    await fx.deps.locks.acquire(`slot:${slot.date}:${slot.tableId}`, 10_000);
    expect(await confirmAndExecute(fx.deps, "s1", action.id, "turn_2")).toMatchObject({
      status: "failed",
      reason: "slot_locked",
    });
    expect(fx.deps.calendar.writes).toEqual([]);
  });

  it("releases the slot lock after executing", async () => {
    const { fx, action, slot } = await pendingBook();
    await confirmAndExecute(fx.deps, "s1", action.id, "turn_2");
    expect(await fx.deps.locks.acquire(`slot:${slot.date}:${slot.tableId}`, 10_000)).toBeDefined();
  });

  it("fails as calendar_unavailable when Calendar is down", async () => {
    const { fx, action } = await pendingBook();
    fx.deps.calendar.setUnavailable(true);
    expect(await confirmAndExecute(fx.deps, "s1", action.id, "turn_2")).toMatchObject({
      status: "failed",
      reason: "calendar_unavailable",
    });
    expect(stages(fx, action.id)).toEqual(["proposed", "confirmed", "failed"]);
    expect(fx.deps.audit.entries().at(-1)!.reason).toBe("calendar_unavailable");
  });

  it("writes nothing when the confirmed audit append fails", async () => {
    const { fx, action } = await pendingBook();
    fx.deps.audit.failNext();
    expect(await confirmAndExecute(fx.deps, "s1", action.id, "turn_2")).toMatchObject({
      status: "failed",
      reason: "audit_failed",
    });
    expect(fx.deps.calendar.writes).toEqual([]);
  });

  it("reschedules, ignoring the booking's own old time in the re-check", async () => {
    const fx = agentFixture(testConfig());
    await fx.find("Ana Ruiz", "ana@example.com");
    // 19:30 the same evening overlaps Ana's own hold on t4-1.
    const slotId = await fx.offer("2026-11-06", "19:30", 4);
    const result = await propose(fx.deps, fx.session, "turn_1", "reschedule", {
      reservationId: ANA.id,
      slotId,
    });
    if (!result.ok) throw new Error(result.message);
    const outcome = await confirmAndExecute(fx.deps, "s1", result.action.id, "turn_2");
    expect(outcome).toMatchObject({ status: "executed" });
    expect(outcome.reply).toBe(
      "Done. Your reservation for 4 is now on Friday, November 6 at 7:30 PM. A confirmation email is on its way.",
    );
    const moved = await fx.deps.calendar.getReservation(ANA.id);
    expect(moved!.start.toISOString()).toBe(new Date("2026-11-06T19:30:00-05:00").toISOString());
    expect(fx.deps.calendar.writes).toEqual([{ op: "move", id: ANA.id }]);
  });

  it("changes the party size with one move, never a cancel", async () => {
    const fx = agentFixture(testConfig());
    await fx.find("Ana Ruiz", "ana@example.com");
    const slotId = await fx.offer("2026-11-06", "19:00", 6);
    const result = await propose(fx.deps, fx.session, "turn_1", "reschedule", {
      reservationId: ANA.id,
      slotId,
    });
    if (!result.ok) throw new Error(result.message);
    const outcome = await confirmAndExecute(fx.deps, "s1", result.action.id, "turn_2");
    expect(outcome.reply).toBe(
      "Done. Your reservation for 6 is now on Friday, November 6 at 7:00 PM. A confirmation email is on its way.",
    );
    expect(await fx.deps.calendar.getReservation(ANA.id)).toMatchObject({
      partySize: 6,
      tableId: fx.session.offeredSlots[slotId]!.tableId,
      name: "Ana Ruiz",
    });
    expect(fx.deps.calendar.writes).toEqual([{ op: "move", id: ANA.id }]);
  });

  it("cancels a confirmed cancel", async () => {
    const fx = agentFixture(testConfig());
    await fx.find("Ana Ruiz", "ana@example.com");
    const result = await propose(fx.deps, fx.session, "turn_1", "cancel", {
      reservationId: ANA.id,
    });
    if (!result.ok) throw new Error(result.message);
    const outcome = await confirmAndExecute(fx.deps, "s1", result.action.id, "turn_2");
    expect(outcome.reply).toBe(
      "Done. Your reservation for 4 on Friday, November 6 at 7:00 PM is cancelled. A confirmation email is on its way.",
    );
    expect(fx.deps.calendar.writes).toEqual([{ op: "cancel", id: ANA.id }]);
  });

  it("refuses a cancel that drifted into the late-change window before confirmation", async () => {
    const fx = agentFixture(testConfig());
    await fx.find("Ana Ruiz", "ana@example.com");
    fx.deps.clock.advance(ANA.start.getTime() - fx.deps.clock.now().getTime() - 4 * 3600_000);
    const result = await propose(fx.deps, fx.session, "turn_1", "cancel", {
      reservationId: ANA.id,
    });
    if (!result.ok) throw new Error(result.message);
    fx.deps.clock.advance(60_000);
    expect(await confirmAndExecute(fx.deps, "s1", result.action.id, "turn_2")).toMatchObject({
      status: "failed",
      reason: "late_change",
    });
    expect(fx.deps.calendar.writes).toEqual([]);
  });

  it("still succeeds when the confirmation email fails", async () => {
    const { fx, action } = await pendingBook();
    fx.deps.mailer.failNext();
    const outcome = await confirmAndExecute(fx.deps, "s1", action.id, "turn_2");
    expect(outcome).toMatchObject({ status: "executed", emailFailed: true });
    expect(outcome.reply).not.toContain("email");
    expect(fx.deps.calendar.writes).toHaveLength(1);
  });

  it("does not email a phone contact", async () => {
    const fx = agentFixture(testConfig(), []);
    const slotId = await fx.offer("2026-11-07", "19:00", 2);
    const result = await propose(fx.deps, fx.session, "turn_1", "book", {
      slotId,
      name: "Cy",
      contact: "555-010-3000",
      partySize: 2,
      notes: "",
    });
    if (!result.ok) throw new Error(result.message);
    const outcome = await confirmAndExecute(fx.deps, "s1", result.action.id, "turn_2");
    expect(outcome.reply).toBe(
      "You're all set: a table for 2 on Saturday, November 7 at 7:00 PM under Cy.",
    );
    expect(fx.deps.mailer.sent).toEqual([]);
  });
});

describe("confirmAndExecute against a changed reservation", () => {
  it.each(["cancel", "reschedule"] as const)(
    "refuses a %s when the reservation moved after the read-back",
    async (kind) => {
      const fx = agentFixture(testConfig());
      await fx.find("Ana Ruiz", "ana@example.com");
      const slotId = await fx.offer("2026-11-07", "19:00", 4);
      const args =
        kind === "cancel" ? { reservationId: ANA.id } : { reservationId: ANA.id, slotId };
      const result = await propose(fx.deps, fx.session, "turn_1", kind, args);
      if (!result.ok) throw new Error(result.message);
      await fx.deps.calendar.moveReservation(ANA.id, {
        start: new Date("2026-11-08T13:00:00-05:00"),
        end: new Date("2026-11-08T14:30:00-05:00"),
        tableId: "t4-3",
      });
      const writes = fx.deps.calendar.writes.length;
      expect(await confirmAndExecute(fx.deps, "s1", result.action.id, "turn_2")).toMatchObject({
        status: "failed",
        reason: "reservation_changed",
      });
      expect(fx.deps.calendar.writes).toHaveLength(writes);
      expect(stages(fx, result.action.id)).toEqual(["proposed", "confirmed", "failed"]);
    },
  );
});

describe("confirmAndExecute lock release", () => {
  it("reports a write as executed even if releasing the lock fails", async () => {
    const { fx, action } = await pendingBook();
    fx.deps.locks = {
      acquire: () => Promise.resolve({ release: () => Promise.reject(new Error("redis blip")) }),
    } as unknown as typeof fx.deps.locks;
    const outcome = await confirmAndExecute(fx.deps, "s1", action.id, "turn_2");
    expect(outcome).toMatchObject({ status: "executed" });
    expect(stages(fx, action.id)).toEqual(["proposed", "confirmed", "executed"]);
  });
});

describe("voidPending", () => {
  it("clears and audits the pending action", async () => {
    const { fx, action } = await pendingBook();
    expect((await voidPending(fx.deps, "s1", "turn_2", "deny"))?.id).toBe(action.id);
    expect(await fx.deps.sessions.getPending("s1")).toBeUndefined();
    expect(stages(fx, action.id)).toEqual(["proposed", "voided"]);
    expect(await voidPending(fx.deps, "s1", "turn_3", "deny")).toBeUndefined();
  });
});

describe("booking quota (M10)", () => {
  it("records the booking after a successful create, in the business day", async () => {
    const { fx, action } = await pendingBook();
    const quota = new InMemoryBookingQuota(2);
    await confirmAndExecute({ ...fx.deps, bookingQuota: quota }, "s1", action.id, "turn_2");
    expect(await quota.remaining("bo@example.com", "2026-11-04")).toBe(1);
  });

  it("does not record when the create fails", async () => {
    const { fx, action } = await pendingBook();
    const quota = new InMemoryBookingQuota(2);
    fx.deps.calendar.setUnavailable(true);
    await confirmAndExecute({ ...fx.deps, bookingQuota: quota }, "s1", action.id, "turn_2");
    expect(await quota.remaining("bo@example.com", "2026-11-04")).toBe(2);
  });

  it("a failing quota store doesn't fail the booking", async () => {
    const { fx, action } = await pendingBook();
    const quota = {
      remaining: () => Promise.resolve(2),
      record: () => Promise.reject(new Error("redis down")),
    };
    const outcome = await confirmAndExecute(
      { ...fx.deps, bookingQuota: quota },
      "s1",
      action.id,
      "turn_2",
    );
    expect(outcome.status).toBe("executed");
  });
});
