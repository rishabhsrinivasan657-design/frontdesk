import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { testConfig } from "../config/test-config.js";
import { findSlots as findSlotsFromIndex, UnknownTableError } from "../index.js";
import { findSlots } from "./find-slots.js";
import { tablesFromConfig } from "./tables.js";
import type { Reservation } from "./types.js";

const config = testConfig();
const now = new Date("2026-11-02T09:00:00-05:00");
const TUESDAY = "2026-11-03";

const at = (time: string) =>
  DateTime.fromISO(`${TUESDAY}T${time}`, { zone: "America/New_York" }).toJSDate();

/** Every table reserved on [start, end). */
const allTables = (start: string, end: string): Reservation[] =>
  tablesFromConfig(config).map((t) => ({
    id: `r-${t.id}`,
    start: at(start),
    end: at(end),
    tableId: t.id,
    partySize: 2,
  }));

const timesFor = (time: string, reservations: Reservation[] = []) =>
  findSlots(config, reservations, { date: TUESDAY, time, partySize: 2 }, now).map((s) => s.time);

describe("findSlots with a requested time", () => {
  it("returns just that slot when it's available", () => {
    expect(timesFor("19:00")).toEqual(["19:00"]);
  });

  it("returns the nearest alternatives on both sides when it's taken", () => {
    // Blocks starts 17:30–19:00.
    expect(timesFor("19:00", allTables("18:45", "19:15"))).toEqual(["17:15", "19:15", "19:30"]);
  });

  it("fills from one side when the other has nothing", () => {
    expect(timesFor("23:00")).toEqual(["20:30", "20:45", "21:00"]);
  });

  it("treats an off-grid time as unavailable", () => {
    expect(timesFor("19:07")).toEqual(["18:45", "19:00", "19:15"]);
  });

  it("breaks a distance tie toward the earlier time", () => {
    // Blocks starts 18:15–19:45, leaving 18:00 and 20:00 equidistant, then 17:45 vs 20:15.
    expect(timesFor("19:00", allTables("19:30", "20:00"))).toEqual(["17:45", "18:00", "20:00"]);
  });

  it("returns fewer than 3 when fewer are free", () => {
    expect(timesFor("19:00", allTables("17:00", "20:45"))).toEqual(["20:45", "21:00"]);
  });

  it("returns [] when nothing is free on the date", () => {
    expect(timesFor("19:00", allTables("17:00", "23:00"))).toEqual([]);
  });

  it("is exported from the package index", () => {
    expect(findSlotsFromIndex).toBe(findSlots);
    expect(new UnknownTableError("r", "t").name).toBe("UnknownTableError");
  });
});
