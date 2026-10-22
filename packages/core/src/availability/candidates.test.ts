import { describe, expect, it } from "vitest";
import { testConfig } from "../config/test-config.js";
import { findSlots } from "./find-slots.js";
import type { SlotRequest } from "./types.js";

const config = testConfig();
const mondayMorning = new Date("2026-11-02T09:00:00-05:00");

const times = (request: SlotRequest, now = mondayMorning, cfg = config) =>
  findSlots(cfg, [], request, now).map((slot) => slot.time);

describe("findSlots candidates", () => {
  it("Tuesday 2026-11-03 has 17 slots 17:00–21:00", () => {
    const result = times({ date: "2026-11-03", partySize: 2 });
    expect(result).toHaveLength(17);
    expect(result[0]).toBe("17:00");
    expect(result[1]).toBe("17:15");
    expect(result.at(-1)).toBe("21:00");
  });

  it("Friday runs to 22:00, Sunday 12:00–20:00, Monday is closed", () => {
    const friday = times({ date: "2026-11-06", partySize: 2 });
    expect(friday).toHaveLength(21);
    expect(friday.at(-1)).toBe("22:00");

    const sunday = times({ date: "2026-11-08", partySize: 2 });
    expect(sunday).toHaveLength(33);
    expect([sunday[0], sunday.at(-1)]).toEqual(["12:00", "20:00"]);

    expect(times({ date: "2026-11-09", partySize: 2 })).toEqual([]);
  });

  it("closure date 2026-11-26 returns []", () => {
    expect(times({ date: "2026-11-26", partySize: 2 })).toEqual([]);
  });

  it("lead time is inclusive", () => {
    const request = { date: "2026-11-03", partySize: 2 };
    expect(times(request, new Date("2026-11-03T16:30:00-05:00"))[0]).toBe("17:30");
    expect(times(request, new Date("2026-11-03T16:31:00-05:00"))[0]).toBe("17:45");
    expect(times({ date: "2026-10-27", partySize: 2 })).toEqual([]);
  });

  it("booking window is 30 local days", () => {
    expect(times({ date: "2026-12-02", partySize: 2 })).not.toEqual([]);
    expect(times({ date: "2026-12-03", partySize: 2 })).toEqual([]);
  });

  it("window counts from the business-local date", () => {
    const lateMondayInNewYork = new Date("2026-11-03T03:30:00Z"); // Nov 2, 22:30 EST
    expect(times({ date: "2026-12-02", partySize: 2 }, lateMondayInNewYork)).not.toEqual([]);
    expect(times({ date: "2026-12-03", partySize: 2 }, lateMondayInNewYork)).toEqual([]);
  });

  it("slot shape", () => {
    const slot = findSlots(config, [], { date: "2026-11-03", partySize: 2 }, mondayMorning).find(
      (s) => s.time === "19:00",
    );
    expect(slot).toEqual({
      id: "2026-11-03T19:00@t2-1#2",
      date: "2026-11-03",
      time: "19:00",
      start: "2026-11-03T19:00:00-05:00",
      end: "2026-11-03T20:30:00-05:00",
      tableId: "t2-1",
      tableSize: 2,
      partySize: 2,
    });
  });

  it("DST fall back: offsets follow the local date", () => {
    const now = new Date("2026-10-26T09:00:00-04:00");
    const saturday = findSlots(config, [], { date: "2026-10-31", partySize: 2 }, now);
    expect(saturday[0]!.start).toBe("2026-10-31T17:00:00-04:00");
    const sunday = findSlots(config, [], { date: "2026-11-01", partySize: 2 }, now);
    expect(sunday[0]!.start).toBe("2026-11-01T12:00:00-05:00");
  });

  const nightConfig = () => {
    const cfg = testConfig();
    cfg.hours.sun = [{ open: "00:00", close: "04:00" }];
    return cfg;
  };

  it("DST spring forward skips nonexistent wall times; holds are real minutes", () => {
    const now = new Date("2027-03-01T09:00:00-05:00");
    const slots = findSlots(nightConfig(), [], { date: "2027-03-14", partySize: 2 }, now);
    expect(slots.map((s) => s.time)).toEqual([
      "00:00",
      "00:15",
      "00:30",
      "00:45",
      "01:00",
      "01:15",
      "01:30",
      "01:45",
      "03:00",
    ]);
    expect(slots.find((s) => s.time === "01:00")!.end).toBe("2027-03-14T03:30:00-04:00");
  });

  it("DST fall back lists each ambiguous wall time once, at the earlier offset", () => {
    const now = new Date("2026-10-20T09:00:00-04:00");
    const slots = findSlots(nightConfig(), [], { date: "2026-11-01", partySize: 2 }, now);
    expect(slots).toHaveLength(13);
    expect(new Set(slots.map((s) => s.time)).size).toBe(13);
    expect(slots.find((s) => s.time === "01:00")!.start).toBe("2026-11-01T01:00:00-04:00");
    const instants = slots.map((s) => Date.parse(s.start));
    expect(instants).toEqual([...instants].sort((a, b) => a - b));
  });

  it.each<[string, SlotRequest]>([
    ["date", { date: "2026-02-30", partySize: 2 }],
    ["date", { date: "11/03/2026", partySize: 2 }],
    ["time", { date: "2026-11-03", time: "7pm", partySize: 2 }],
    ["partySize", { date: "2026-11-03", partySize: 0 }],
    ["partySize", { date: "2026-11-03", partySize: 2.5 }],
  ])("rejects a malformed %s", (field, request) => {
    expect(() => findSlots(config, [], request, mondayMorning)).toThrow(RangeError);
    expect(() => findSlots(config, [], request, mondayMorning)).toThrow(field);
  });

  it("rejects an invalid now instead of skipping lead time and the window", () => {
    const request = { date: "2027-06-01", partySize: 2 };
    expect(() => findSlots(config, [], request, new Date("x"))).toThrow(RangeError);
    expect(() => findSlots(config, [], request, new Date("x"))).toThrow("now");
  });
});
