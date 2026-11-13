import { describe, expect, it } from "vitest";
import { twelveHourTimes } from "./twelve-hour.js";

describe("twelveHourTimes", () => {
  it("says evening times the way people do", () => {
    expect(twelveHourTimes("We're open from 12:00 to 21:00.")).toBe(
      "We're open from 12:00 PM to 9:00 PM.",
    );
    expect(twelveHourTimes("I have 19:30 free.")).toBe("I have 7:30 PM free.");
  });

  it("handles ranges and midnight", () => {
    expect(twelveHourTimes("Sat 17:00-22:00")).toBe("Sat 5:00 PM-10:00 PM");
    expect(twelveHourTimes("until 00:00")).toBe("until 12:00 AM");
  });

  it("leaves times that already say AM or PM alone", () => {
    expect(twelveHourTimes("7:00 PM or 21:00 pm")).toBe("7:00 PM or 21:00 pm");
    expect(twelveHourTimes("at 12:30 p.m.")).toBe("at 12:30 p.m.");
  });

  it("leaves 1:00 to 11:59 alone, since 7:30 at a restaurant is never a guess we should make", () => {
    expect(twelveHourTimes("How about 7:30 or 08:15?")).toBe("How about 7:30 or 08:15?");
  });

  it("does not touch timestamps, seconds or other numbers", () => {
    expect(twelveHourTimes("2026-11-08T19:00:00")).toBe("2026-11-08T19:00:00");
    expect(twelveHourTimes("at 19:00:30")).toBe("at 19:00:30");
    expect(twelveHourTimes("ratio 3:1, score 25:00")).toBe("ratio 3:1, score 25:00");
  });
});
