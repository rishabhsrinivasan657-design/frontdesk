import { describe, expect, it } from "vitest";
import { testConfig } from "../config/test-config.js";
import { agentFixture, ANA } from "../testing/agent-fixtures.js";
import { propose } from "./propose.js";
import { readBack } from "./summary.js";

const book = (slotId: string, partySize = 4) => ({
  slotId,
  name: "Ana Ruiz",
  contact: "ana@example.com",
  partySize,
  notes: "",
});

describe("propose", () => {
  it("rejects a slot id that check_availability never returned", async () => {
    const fx = agentFixture(testConfig());
    const result = await propose(
      fx.deps,
      fx.session,
      "turn_1",
      "book",
      book("2026-11-07T19:00@t4-1#4"),
    );
    expect(result).toMatchObject({ ok: false, error: "unknown_slot" });
    expect(fx.deps.audit.entries()).toEqual([]);
    expect(await fx.deps.sessions.getPending("s1")).toBeUndefined();
  });

  it.each(["reschedule", "cancel"] as const)(
    "rejects %s of a reservation find_reservation never returned",
    async (name) => {
      const fx = agentFixture(testConfig());
      const slotId = await fx.offer("2026-11-07", "19:00", 4);
      const args =
        name === "cancel" ? { reservationId: ANA.id } : { reservationId: ANA.id, slotId };
      const result = await propose(fx.deps, fx.session, "turn_1", name, args);
      expect(result).toMatchObject({ ok: false, error: "unknown_reservation" });
      expect(fx.deps.audit.entries()).toEqual([]);
    },
  );

  it("stores a pending book with a 5 minute expiry and audits proposed", async () => {
    const fx = agentFixture(testConfig(), []);
    const slotId = await fx.offer("2026-11-06", "19:00", 4);
    const result = await propose(fx.deps, fx.session, "turn_1", "book", book(slotId));
    if (!result.ok) throw new Error(result.message);
    expect(result.action.expiresAt).toBe(
      new Date(fx.deps.clock.now().getTime() + 300_000).toISOString(),
    );
    expect(await fx.deps.sessions.getPending("s1")).toEqual(result.action);
    expect(fx.deps.audit.entries().map((e) => [e.actionId, e.stage])).toEqual([
      [result.action.id, "proposed"],
    ]);
    expect(readBack(result.action, testConfig())).toBe(
      "To confirm: a table for 4 on Friday, November 6 at 7:00 PM under Ana Ruiz, contact ana@example.com. Shall I book it?",
    );
    expect(result.action.summary).toBe(readBack(result.action, testConfig()));
    expect(fx.deps.calendar.writes).toEqual([]);
  });

  it("supersedes an earlier pending action", async () => {
    const fx = agentFixture(testConfig(), []);
    const first = await propose(
      fx.deps,
      fx.session,
      "turn_1",
      "book",
      book(await fx.offer("2026-11-06", "19:00", 4)),
    );
    const second = await propose(
      fx.deps,
      fx.session,
      "turn_2",
      "book",
      book(await fx.offer("2026-11-06", "20:00", 4)),
    );
    if (!first.ok || !second.ok) throw new Error("expected both ok");
    expect(fx.deps.audit.entries().map((e) => [e.actionId, e.stage, e.reason])).toEqual([
      [first.action.id, "proposed", undefined],
      [second.action.id, "proposed", undefined],
      [first.action.id, "voided", "superseded"],
    ]);
    expect((await fx.deps.sessions.getPending("s1"))?.id).toBe(second.action.id);
  });

  it("refuses a second booking for the same caller at an overlapping time", async () => {
    const fx = agentFixture(testConfig());
    const slotId = await fx.offer("2026-11-06", "19:30", 4);
    const result = await propose(fx.deps, fx.session, "turn_1", "book", {
      ...book(slotId),
      contact: "ANA@example.com ",
    });
    expect(result).toMatchObject({ ok: false, error: "duplicate_booking" });
    expect((result as { message: string }).message).toContain(ANA.id);
    // The existing booking is now known, so the agent can reschedule or cancel it.
    expect(Object.keys(fx.session.knownReservations)).toContain(ANA.id);
    expect(fx.deps.audit.entries()).toEqual([]);
  });

  it.each([
    ["the same name with a different contact", { contact: "ana.other@example.com" }],
    ["a different name with the same contact", { name: "Mia Torres" }],
  ])("allows a booking at an overlapping time for %s", async (_label, over) => {
    const fx = agentFixture(testConfig());
    const slotId = await fx.offer("2026-11-06", "19:30", 4);
    const result = await propose(fx.deps, fx.session, "turn_1", "book", {
      ...book(slotId),
      ...over,
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("hands off a booking for a party larger than every table", async () => {
    const fx = agentFixture(testConfig());
    await expect(
      propose(fx.deps, fx.session, "turn_1", "book", book("2026-11-06T19:00@t6-1#7", 7)),
    ).rejects.toMatchObject({ name: "HandoffSignal", reason: "party_too_large" });
  });

  it("hands off a cancel inside the free-change window", async () => {
    const fx = agentFixture(testConfig());
    await fx.find("Ana Ruiz", "ana@example.com");
    fx.deps.clock.advance(
      ANA.start.getTime() - fx.deps.clock.now().getTime() - (4 * 3600_000 - 60_000),
    );
    await expect(
      propose(fx.deps, fx.session, "turn_1", "cancel", { reservationId: ANA.id }),
    ).rejects.toMatchObject({ name: "HandoffSignal", reason: "late_change" });
    expect(await fx.deps.sessions.getPending("s1")).toBeUndefined();
  });

  it("allows a cancel exactly at the window edge", async () => {
    const fx = agentFixture(testConfig());
    await fx.find("Ana Ruiz", "ana@example.com");
    fx.deps.clock.advance(ANA.start.getTime() - fx.deps.clock.now().getTime() - 4 * 3600_000);
    const result = await propose(fx.deps, fx.session, "turn_1", "cancel", {
      reservationId: ANA.id,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a party size that differs from the offered slot", async () => {
    const fx = agentFixture(testConfig(), []);
    const slotId = await fx.offer("2026-11-06", "19:00", 4);
    expect(await propose(fx.deps, fx.session, "turn_1", "book", book(slotId, 3))).toMatchObject({
      ok: false,
      error: "party_mismatch",
    });
  });

  it("rejects a reschedule to a slot for a different party size", async () => {
    const fx = agentFixture(testConfig());
    await fx.find("Ana Ruiz", "ana@example.com");
    const slotId = await fx.offer("2026-11-07", "19:00", 2);
    expect(
      await propose(fx.deps, fx.session, "turn_1", "reschedule", { reservationId: ANA.id, slotId }),
    ).toMatchObject({ ok: false, error: "party_mismatch" });
  });

  it("rejects an offered slot that has since been taken", async () => {
    const fx = agentFixture(testConfig(), []);
    const slotId = await fx.offer("2026-11-06", "19:00", 4);
    const slot = fx.session.offeredSlots[slotId]!;
    await fx.deps.calendar.createReservation({
      start: new Date(slot.start),
      end: new Date(slot.end),
      tableId: slot.tableId,
      partySize: 4,
      name: "Someone",
      contact: "x@example.com",
      notes: "",
    });
    expect(await propose(fx.deps, fx.session, "turn_1", "book", book(slotId))).toMatchObject({
      ok: false,
      error: "slot_taken",
    });
  });

  it("stores nothing when the proposed audit append fails", async () => {
    const fx = agentFixture(testConfig(), []);
    const slotId = await fx.offer("2026-11-06", "19:00", 4);
    fx.deps.audit.failNext();
    await expect(propose(fx.deps, fx.session, "turn_1", "book", book(slotId))).rejects.toThrow();
    expect(await fx.deps.sessions.getPending("s1")).toBeUndefined();
  });

  it("reads back reschedules and cancels", async () => {
    const fx = agentFixture(testConfig());
    await fx.find("Ana Ruiz", "ana@example.com");
    const slotId = await fx.offer("2026-11-07", "19:00", 4);
    const move = await propose(fx.deps, fx.session, "turn_1", "reschedule", {
      reservationId: ANA.id,
      slotId,
    });
    if (!move.ok) throw new Error(move.message);
    expect(move.action.summary).toBe(
      "To confirm: move your reservation for 4 from Friday, November 6 at 7:00 PM to Saturday, November 7 at 7:00 PM. Shall I make the change?",
    );
    const cancel = await propose(fx.deps, fx.session, "turn_2", "cancel", {
      reservationId: ANA.id,
    });
    if (!cancel.ok) throw new Error(cancel.message);
    expect(cancel.action.summary).toBe(
      "To confirm: cancel your reservation for 4 on Friday, November 6 at 7:00 PM. Shall I cancel it?",
    );
  });

  it("keeps the new pending action when auditing the superseded one fails", async () => {
    const fx = agentFixture(testConfig(), []);
    const first = await propose(
      fx.deps,
      fx.session,
      "turn_1",
      "book",
      book(await fx.offer("2026-11-06", "19:00", 4)),
    );
    if (!first.ok) throw new Error(first.message);
    fx.deps.audit.failWhen((e) => e.stage === "voided");
    const second = await propose(
      fx.deps,
      fx.session,
      "turn_2",
      "book",
      book(await fx.offer("2026-11-06", "20:00", 4)),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect((await fx.deps.sessions.getPending("s1"))?.id).toBe(second.action.id);
  });

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])(
    "treats the prototype key %s as unknown provenance",
    async (key) => {
      const fx = agentFixture(testConfig(), [{ ...ANA, id: key }]);
      expect(await propose(fx.deps, fx.session, "turn_1", "book", book(key))).toMatchObject({
        ok: false,
        error: "unknown_slot",
      });
      expect(
        await propose(fx.deps, fx.session, "turn_1", "cancel", { reservationId: key }),
      ).toMatchObject({
        ok: false,
        error: "unknown_reservation",
      });
    },
  );

  it("rejects a book whose contact is the caller's name, not a phone or email", async () => {
    const fx = agentFixture(testConfig(), []);
    const slotId = await fx.offer("2026-11-06", "19:00", 2);
    const result = await propose(fx.deps, fx.session, "turn_1", "book", {
      slotId,
      name: "Dev Shah",
      contact: "Dev Shah",
      partySize: 2,
    });
    expect(result).toMatchObject({ ok: false, error: "invalid_args" });
    expect(JSON.stringify(result)).toContain("phone number or email");
    expect(await fx.deps.sessions.getPending("s1")).toBeUndefined();
  });

  it("rejects invalid args", async () => {
    const fx = agentFixture(testConfig());
    expect(await propose(fx.deps, fx.session, "turn_1", "book", { slotId: 7 })).toMatchObject({
      ok: false,
      error: "invalid_args",
    });
  });
});
