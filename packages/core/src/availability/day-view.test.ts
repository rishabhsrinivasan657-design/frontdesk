import { describe, expect, it } from "vitest";
import { testConfig } from "../config/test-config.js";
import type { Booking } from "../ports/calendar.js";
import { dayRange, dayView, weekStrip } from "./day-view.js";

const booking = (o: Partial<Booking> & Pick<Booking, "start" | "end">): Booking => ({
  id: "res_1",
  tableId: "t4-1",
  partySize: 4,
  name: "Bo Chen",
  contact: "bo@example.com",
  notes: "",
  ...o,
});

describe("dayView: the owner's calendar for one restaurant day", () => {
  it("lists every table, the opening hours and the seats", () => {
    const v = dayView(testConfig(), "2026-11-07", []);
    expect(v.label).toBe("Saturday, November 7");
    expect(v.open).toBe(true);
    expect(v.hours).toEqual([{ open: "17:00", close: "23:00" }]);
    expect(v.tables).toHaveLength(16);
    expect(v.tables[0]).toEqual({ id: "t2-1", size: 2 });
    expect(v.seats).toBe(8 * 2 + 6 * 4 + 2 * 6);
  });

  it("places each reservation in local minutes, with labels, earliest first", () => {
    const late = booking({
      id: "res_late",
      start: new Date("2026-11-07T20:30:00-05:00"),
      end: new Date("2026-11-07T22:00:00-05:00"),
    });
    const early = booking({
      id: "res_early",
      tableId: "t2-3",
      partySize: 2,
      start: new Date("2026-11-07T17:15:00-05:00"),
      end: new Date("2026-11-07T18:45:00-05:00"),
    });
    const v = dayView(testConfig(), "2026-11-07", [late, early]);
    expect(v.reservations.map((r) => r.id)).toEqual(["res_early", "res_late"]);
    expect(v.reservations[0]).toMatchObject({
      tableId: "t2-3",
      startMinute: 17 * 60 + 15,
      endMinute: 18 * 60 + 45,
      startLabel: "5:15 PM",
      endLabel: "6:45 PM",
      partySize: 2,
    });
  });

  it("ignores reservations on other days", () => {
    const friday = booking({
      start: new Date("2026-11-06T19:00:00-05:00"),
      end: new Date("2026-11-06T20:30:00-05:00"),
    });
    expect(dayView(testConfig(), "2026-11-07", [friday]).reservations).toEqual([]);
  });

  it("a weekly closed day and a holiday closure are both closed", () => {
    expect(dayView(testConfig(), "2026-11-09", []).open).toBe(false); // Monday
    expect(dayView(testConfig(), "2026-11-26", []).open).toBe(false); // Thanksgiving
  });

  it("dayRange is local midnight to local midnight", () => {
    const { from, to } = dayRange(testConfig(), "2026-11-07");
    expect(from.toISOString()).toBe("2026-11-07T05:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-08T05:00:00.000Z");
  });
});

describe("weekStrip: seven days from today", () => {
  it("counts bookings and guests per day, and marks closed days", () => {
    const sat = booking({
      start: new Date("2026-11-07T19:00:00-05:00"),
      end: new Date("2026-11-07T20:30:00-05:00"),
    });
    const sat2 = booking({
      id: "res_2",
      partySize: 2,
      start: new Date("2026-11-07T20:00:00-05:00"),
      end: new Date("2026-11-07T21:30:00-05:00"),
    });
    const week = weekStrip(testConfig(), "2026-11-05", [sat, sat2]);
    expect(week.map((d) => d.date)).toEqual([
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
    ]);
    expect(week[0]).toMatchObject({ label: "Thu 5", open: true, bookings: 0, guests: 0 });
    expect(week[2]).toMatchObject({ label: "Sat 7", bookings: 2, guests: 6 });
    expect(week[4]).toMatchObject({ label: "Mon 9", open: false });
  });
});
