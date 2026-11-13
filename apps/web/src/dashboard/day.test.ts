import { describe, expect, it } from "vitest";
import { busiest, minuteLabel, occupancy, tableLabel, visibleRange } from "./day";

const r = (startMinute: number, endMinute: number) => ({ startMinute, endMinute });

describe("the owner's day view helpers", () => {
  it("names tables the way staff say them", () => {
    expect(tableLabel("t4-2")).toBe("4-top · 2");
    expect(tableLabel("odd")).toBe("odd");
  });

  it("labels minutes since midnight as clock times", () => {
    expect(minuteLabel(17 * 60)).toBe("5:00 PM");
    expect(minuteLabel(12 * 60 + 30)).toBe("12:30 PM");
    expect(minuteLabel(9 * 60)).toBe("9:00 AM");
  });

  it("shows opening hours rounded out to whole hours", () => {
    expect(visibleRange([{ open: "17:00", close: "22:30" }], [])).toEqual({
      from: 17 * 60,
      to: 23 * 60,
    });
  });

  it("stretches to include a booking outside the hours, and has a default when closed", () => {
    expect(
      visibleRange([{ open: "17:00", close: "22:00" }], [r(16 * 60 + 15, 17 * 60 + 45)]),
    ).toEqual({ from: 16 * 60, to: 22 * 60 });
    expect(visibleRange([], [])).toEqual({ from: 17 * 60, to: 23 * 60 });
  });

  it("counts tables in use for each 15 minutes, and finds the busiest", () => {
    const day = [r(18 * 60, 19 * 60 + 30), r(19 * 60, 20 * 60 + 30), r(19 * 60 + 15, 20 * 60)];
    const occ = occupancy(day, { from: 18 * 60, to: 21 * 60 });
    expect(occ).toHaveLength(12);
    expect(occ[0]).toEqual({ minute: 18 * 60, tables: 1 });
    expect(occ.find((o) => o.minute === 19 * 60 + 15)?.tables).toBe(3);
    expect(busiest(day, { from: 18 * 60, to: 21 * 60 })).toEqual({
      minute: 19 * 60 + 15,
      tables: 3,
    });
    expect(busiest([], { from: 18 * 60, to: 21 * 60 })).toBeNull();
  });
});
