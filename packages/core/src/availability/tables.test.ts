import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { testConfig } from "../config/test-config.js";
import { findSlots } from "./find-slots.js";
import { UnknownTableError, holdMinutesFor, tablesFromConfig } from "./tables.js";
import type { Reservation } from "./types.js";

const config = testConfig();
const now = new Date("2026-11-02T09:00:00-05:00");
const TUESDAY = "2026-11-03";

const at = (date: string, time: string) =>
  DateTime.fromISO(`${date}T${time}`, { zone: "America/New_York" }).toJSDate();

let nextId = 0;
const res = (tableId: string, start: string, end: string, date = TUESDAY): Reservation => ({
  id: `r${++nextId}`,
  start: at(date, start),
  end: at(date, end),
  tableId,
  partySize: 2,
});

const ids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}-${i + 1}`);

const slotAt = (reservations: Reservation[], partySize: number, time: string) =>
  findSlots(config, reservations, { date: TUESDAY, partySize }, now).find((s) => s.time === time);

describe("tables", () => {
  it("tablesFromConfig yields 16 tables in size order", () => {
    expect(tablesFromConfig(config).map((t) => t.id)).toEqual([
      ...ids("t2", 8),
      ...ids("t4", 6),
      ...ids("t6", 2),
    ]);
  });

  it("holdMinutesFor uses 120 for parties of 5+", () => {
    expect(holdMinutesFor(config, 4)).toBe(90);
    expect(holdMinutesFor(config, 5)).toBe(120);
  });

  it("picks the smallest fitting table", () => {
    expect(slotAt([], 2, "19:00")?.tableId).toBe("t2-1");
    expect(slotAt([], 3, "19:00")?.tableId).toBe("t4-1");
    expect(slotAt([], 5, "19:00")?.tableId).toBe("t6-1");
  });

  it("hold length depends on party size", () => {
    expect(slotAt([], 4, "19:00")?.end).toBe("2026-11-03T20:30:00-05:00");
    expect(slotAt([], 5, "19:00")?.end).toBe("2026-11-03T21:00:00-05:00");
  });

  it("moves to the next size up when the smallest size is full", () => {
    const twos = ids("t2", 8).map((id) => res(id, "19:00", "20:30"));
    const fours = ids("t4", 6).map((id) => res(id, "19:00", "20:30"));
    const sixes = ids("t6", 2).map((id) => res(id, "19:00", "20:30"));
    expect(slotAt(twos, 2, "19:00")?.tableId).toBe("t4-1");
    expect(slotAt([...twos, ...fours], 2, "19:00")?.tableId).toBe("t6-1");
    expect(slotAt([...twos, ...fours, ...sixes], 2, "19:00")).toBeUndefined();
  });

  it("holds are half-open intervals", () => {
    const reservations = [res("t2-1", "19:00", "20:30")];
    expect(slotAt(reservations, 2, "17:30")?.tableId).toBe("t2-1");
    expect(slotAt(reservations, 2, "17:45")?.tableId).toBe("t2-2");
    expect(slotAt(reservations, 2, "20:30")?.tableId).toBe("t2-1");
  });

  it("parties of 5+ need a table free for 120 minutes", () => {
    const reservations = ids("t6", 2).map((id) => res(id, "19:00", "21:00"));
    const result = findSlots(config, reservations, { date: TUESDAY, partySize: 5 }, now).map(
      (s) => s.time,
    );
    expect(result).toEqual(["17:00", "21:00"]);
  });

  it("reservations on other days don't block", () => {
    const reservations = ids("t2", 8).map((id) => res(id, "19:00", "20:30", "2026-11-04"));
    expect(slotAt(reservations, 2, "19:00")?.tableId).toBe("t2-1");
  });

  it.each([7, 8, 9])("a party of %i gets no slots (tables are never combined)", (partySize) => {
    expect(findSlots(config, [], { date: TUESDAY, partySize }, now)).toEqual([]);
  });

  it("throws UnknownTableError for a reservation on a table the config doesn't have", () => {
    const stray = { ...res("t10-1", "19:00", "20:30"), id: "evt-stray" };
    expect(() => findSlots(config, [stray], { date: TUESDAY, partySize: 2 }, now)).toThrow(
      UnknownTableError,
    );
    expect(() => findSlots(config, [stray], { date: TUESDAY, partySize: 2 }, now)).toThrow(
      /evt-stray.*t10-1/,
    );
  });

  it.each<[string, Partial<Reservation>]>([
    ["unparseable times", { start: new Date("garbage"), end: new Date("garbage") }],
    ["end before start", { start: at(TUESDAY, "20:30"), end: at(TUESDAY, "19:00") }],
    ["zero length", { start: at(TUESDAY, "19:00"), end: at(TUESDAY, "19:00") }],
  ])("throws RangeError for a reservation with %s instead of treating it as free", (_n, times) => {
    const bad = { ...res("t2-1", "19:00", "20:30"), ...times, id: "evt-bad" };
    expect(() => findSlots(config, [bad], { date: TUESDAY, partySize: 2 }, now)).toThrow(
      RangeError,
    );
    expect(() => findSlots(config, [bad], { date: TUESDAY, partySize: 2 }, now)).toThrow("evt-bad");
  });
});
