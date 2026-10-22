import { describe, expect, it } from "vitest";
import { InMemoryCalendar, ManualClock } from "../../adapters/memory/index.js";
import { testConfig } from "../../config/test-config.js";
import type { Booking } from "../../ports/calendar.js";
import { newSession } from "../types.js";
import { formatWhen, pickSpread } from "./format.js";
import { HandoffSignal, runReadTool } from "./read-tools.js";

const NOW = new Date("2026-11-04T14:00:00-05:00");
const ana: Booking = {
  id: "res_ana",
  start: new Date("2026-11-06T19:00:00-05:00"),
  end: new Date("2026-11-06T20:30:00-05:00"),
  tableId: "t4-1",
  partySize: 4,
  name: "Ana Ruiz",
  contact: "ana@example.com",
  notes: "",
};

function setup() {
  const session = newSession("s1", NOW);
  const calendar = new InMemoryCalendar([ana]);
  const ctx = { config: testConfig(), calendar, clock: new ManualClock(NOW), session };
  return { session, calendar, ctx };
}

describe("check_availability", () => {
  it("returns the exact slot and records it as offered", async () => {
    const { ctx, session } = setup();
    const result = await runReadTool(
      "check_availability",
      { date: "2026-11-06", time: "19:00", partySize: 4 },
      ctx,
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        available: true,
        slots: [{ slotId: "2026-11-06T19:00@t4-2#4", time: "19:00" }],
      },
    });
    expect(Object.keys(session.offeredSlots)).toEqual(["2026-11-06T19:00@t4-2#4"]);
  });

  it("without a time returns at most 8 spread slots including first and last", async () => {
    const { ctx, session } = setup();
    const result = await runReadTool(
      "check_availability",
      { date: "2026-11-06", partySize: 2 },
      ctx,
    );
    if (!result.ok) throw new Error("expected ok");
    const slots = (result.data as { slots: { time: string }[] }).slots;
    expect(slots.length).toBe(8);
    expect(slots[0]!.time).toBe("17:00");
    expect(slots.at(-1)!.time).toBe("22:00");
    expect(Object.keys(session.offeredSlots)).toHaveLength(8);
  });

  it("hands off parties above maxPartyForAgent", async () => {
    const { ctx } = setup();
    await expect(
      runReadTool("check_availability", { date: "2026-11-06", partySize: 9 }, ctx),
    ).rejects.toMatchObject({ name: "HandoffSignal", reason: "party_too_large" });
  });

  it("turns an impossible date into invalid_request", async () => {
    const { ctx, session } = setup();
    const result = await runReadTool(
      "check_availability",
      { date: "2026-02-30", partySize: 2 },
      ctx,
    );
    expect(result).toMatchObject({ ok: false, error: "invalid_request" });
    expect(session.offeredSlots).toEqual({});
  });

  it("hands off when Calendar is unavailable", async () => {
    const { ctx, calendar } = setup();
    calendar.setUnavailable(true);
    await expect(
      runReadTool("check_availability", { date: "2026-11-06", partySize: 2 }, ctx),
    ).rejects.toMatchObject({ reason: "calendar_unavailable" });
  });
});

describe("find_reservation", () => {
  it("returns the matching booking without echoing the contact and records it", async () => {
    const { ctx, session } = setup();
    const result = await runReadTool(
      "find_reservation",
      { name: "ana ruiz", contact: "ANA@example.com" },
      ctx,
    );
    expect(result).toMatchObject({
      ok: true,
      data: { reservations: [{ reservationId: "res_ana", partySize: 4 }] },
    });
    expect(JSON.stringify(result)).not.toContain("ana@example.com");
    expect(Object.keys(session.knownReservations)).toEqual(["res_ana"]);
  });

  it("records nothing for a non-matching contact", async () => {
    const { ctx, session } = setup();
    const result = await runReadTool(
      "find_reservation",
      { name: "Ana Ruiz", contact: "other@example.com" },
      ctx,
    );
    expect(result).toMatchObject({ ok: true, data: { reservations: [] } });
    expect(session.knownReservations).toEqual({});
  });

  it("omits past reservations", async () => {
    const { ctx, session } = setup();
    ctx.clock.advance(3 * 86_400_000);
    const result = await runReadTool(
      "find_reservation",
      { name: "Ana Ruiz", contact: "ana@example.com" },
      ctx,
    );
    expect(result).toMatchObject({ ok: true, data: { reservations: [] } });
    expect(session.knownReservations).toEqual({});
  });
});

describe("lookup_faq and get_menu_item", () => {
  it("finds an FAQ by keyword", async () => {
    const { ctx } = setup();
    expect(await runReadTool("lookup_faq", { query: "where can I park?" }, ctx)).toEqual({
      ok: true,
      data: { answers: [{ id: "parking", a: "Street parking only." }] },
    });
  });

  it("finds a menu item by case-insensitive substring", async () => {
    const { ctx } = setup();
    expect(await runReadTool("get_menu_item", { name: "cacio" }, ctx)).toMatchObject({
      ok: true,
      data: { found: true, item: "Cacio e pepe", price: 22 },
    });
    expect(await runReadTool("get_menu_item", { name: "pizza" }, ctx)).toEqual({
      ok: true,
      data: { found: false },
    });
  });
});

describe("dispatch", () => {
  it.each(["book", "reschedule", "cancel", "send_email"])(
    "refuses %s as unknown_tool",
    async (name) => {
      const { ctx, calendar } = setup();
      const result = await runReadTool(name, { slotId: "x", reservationId: "res_ana" }, ctx);
      expect(result).toMatchObject({ ok: false, error: "unknown_tool" });
      expect(calendar.writes).toEqual([]);
    },
  );

  it("rejects invalid args", async () => {
    const { ctx } = setup();
    expect(
      await runReadTool("check_availability", { date: "tomorrow", partySize: 2 }, ctx),
    ).toMatchObject({ ok: false, error: "invalid_args" });
  });

  it("request_handoff throws a HandoffSignal with the reason and summary", async () => {
    const { ctx } = setup();
    const err = await runReadTool(
      "request_handoff",
      { reason: "complaint", summary: "Unhappy with last visit" },
      ctx,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HandoffSignal);
    expect(err).toMatchObject({ reason: "complaint", summary: "Unhappy with last visit" });
  });
});

describe("format helpers", () => {
  it("formatWhen speaks the business-local time", () => {
    expect(formatWhen("2026-11-06T19:00:00-05:00", "America/New_York")).toBe(
      "Friday, November 6 at 7:00 PM",
    );
    expect(formatWhen(new Date("2026-11-07T00:00:00Z"), "America/New_York")).toBe(
      "Friday, November 6 at 7:00 PM",
    );
  });

  it("pickSpread keeps first and last and spaces the rest", () => {
    expect(pickSpread([1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([1, 5, 9]);
    expect(pickSpread([1, 2], 8)).toEqual([1, 2]);
  });
});
