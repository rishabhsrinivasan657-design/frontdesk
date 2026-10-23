import { describe, expect, it } from "vitest";
import type { AuditEvent, PendingAction } from "../../agent/types.js";
import { CalendarUnavailableError } from "../../ports/calendar.js";
import { runCalendarContract } from "../../testing/calendar-contract.js";
import { runMailerContract } from "../../testing/mailer-contract.js";
import {
  InMemoryAuditLog,
  InMemoryCalendar,
  InMemoryMailer,
  InMemorySessionStore,
  InMemorySlotLock,
  ManualClock,
  sequentialIds,
} from "./index.js";

runCalendarContract("InMemoryCalendar", () => new InMemoryCalendar());
runMailerContract("InMemoryMailer", () => ({
  mailer: new InMemoryMailer(),
  to: "ana@example.com",
}));

const pending = (id: string): PendingAction => ({
  id,
  sessionId: "s1",
  args: { kind: "cancel", reservationId: "res_1" },
  summary: "To confirm: cancel",
  proposedTurn: 1,
  expiresAt: "2026-11-04T14:05:00-05:00",
});

describe("InMemorySessionStore pending actions", () => {
  it("takePending with another id returns undefined and keeps the action", async () => {
    const store = new InMemorySessionStore();
    await store.putPending(pending("act_1"));
    expect(await store.takePending("s1", "other")).toBeUndefined();
    expect(await store.getPending("s1")).toEqual(pending("act_1"));
  });

  it("takePending succeeds once for the matching id", async () => {
    const store = new InMemorySessionStore();
    await store.putPending(pending("act_1"));
    expect(await store.takePending("s1", "act_1")).toEqual(pending("act_1"));
    expect(await store.takePending("s1", "act_1")).toBeUndefined();
    expect(await store.getPending("s1")).toBeUndefined();
  });

  it("putPending replaces any existing action", async () => {
    const store = new InMemorySessionStore();
    await store.putPending(pending("act_1"));
    await store.putPending(pending("act_2"));
    expect((await store.getPending("s1"))?.id).toBe("act_2");
    expect((await store.clearPending("s1"))?.id).toBe("act_2");
    expect(await store.getPending("s1")).toBeUndefined();
  });
});

describe("InMemoryAuditLog", () => {
  const event: AuditEvent = {
    at: "2026-11-04T19:00:00.000Z",
    sessionId: "s1",
    turnId: "turn_1",
    actionId: "act_1",
    kind: "cancel",
    stage: "proposed",
    args: { kind: "cancel", reservationId: "res_1" },
  };

  it("entries are frozen copies", async () => {
    const log = new InMemoryAuditLog();
    await log.append(event);
    const [entry] = log.entries();
    expect(Object.isFrozen(entry)).toBe(true);
    expect(() => {
      (entry as { stage: string }).stage = "executed";
    }).toThrow();
    expect(log.entries()[0]!.stage).toBe("proposed");
  });

  it("does not keep a reference to the appended object", async () => {
    const log = new InMemoryAuditLog();
    const mutable = { ...event };
    await log.append(mutable);
    mutable.stage = "executed";
    expect(log.entries()[0]!.stage).toBe("proposed");
  });

  it("failNext makes the next append reject and records nothing", async () => {
    const log = new InMemoryAuditLog();
    log.failNext();
    await expect(log.append(event)).rejects.toThrow();
    expect(log.entries()).toEqual([]);
    await log.append(event);
    expect(log.entries()).toHaveLength(1);
  });
});

describe("InMemorySlotLock", () => {
  it("refuses a held key until release", async () => {
    const clock = new ManualClock(new Date("2026-11-04T19:00:00Z"));
    const locks = new InMemorySlotLock(clock);
    const lease = await locks.acquire("slot:2026-11-06:t4-1", 10_000);
    expect(lease).toBeDefined();
    expect(await locks.acquire("slot:2026-11-06:t4-1", 10_000)).toBeUndefined();
    expect(await locks.acquire("slot:2026-11-06:t4-2", 10_000)).toBeDefined();
    await lease!.release();
    expect(await locks.acquire("slot:2026-11-06:t4-1", 10_000)).toBeDefined();
  });

  it("frees a key once its ttl passes", async () => {
    const clock = new ManualClock(new Date("2026-11-04T19:00:00Z"));
    const locks = new InMemorySlotLock(clock);
    await locks.acquire("k", 10_000);
    clock.advance(9_999);
    expect(await locks.acquire("k", 10_000)).toBeUndefined();
    clock.advance(1);
    expect(await locks.acquire("k", 10_000)).toBeDefined();
  });
});

describe("InMemoryCalendar outages and write log", () => {
  it("setUnavailable makes reads reject with CalendarUnavailableError", async () => {
    const cal = new InMemoryCalendar();
    cal.setUnavailable(true);
    await expect(
      cal.listReservations({ from: new Date(0), to: new Date(1) }),
    ).rejects.toBeInstanceOf(CalendarUnavailableError);
  });

  it("records every write", async () => {
    const cal = new InMemoryCalendar([], sequentialIds());
    const b = await cal.createReservation({
      start: new Date("2026-11-06T00:00:00Z"),
      end: new Date("2026-11-06T01:30:00Z"),
      tableId: "t2-1",
      partySize: 2,
      name: "A",
      contact: "a@example.com",
      notes: "",
    });
    expect(b.id).toBe("res_1");
    await cal.cancelReservation(b.id);
    expect(cal.writes).toEqual([
      { op: "create", id: "res_1" },
      { op: "cancel", id: "res_1" },
    ]);
  });
});

describe("ManualClock", () => {
  it("sleep advances time", async () => {
    const clock = new ManualClock(new Date("2026-11-04T19:00:00Z"));
    await clock.sleep(2000);
    expect(clock.now().toISOString()).toBe("2026-11-04T19:00:02.000Z");
  });
});
