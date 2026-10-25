import { describe, expect, it } from "vitest";
import {
  formatDay,
  formatMs,
  formatSlot,
  formatPct,
  formatTime,
  formatUsd,
  relativeTime,
} from "./format";

describe("format", () => {
  it("formats milliseconds as ms under a second, else seconds", () => {
    expect(formatMs(null)).toBe("—");
    expect(formatMs(812.4)).toBe("812 ms");
    expect(formatMs(1834)).toBe("1.83 s");
  });

  it("formats rates and money", () => {
    expect(formatPct(null)).toBe("—");
    expect(formatPct(0.5)).toBe("50%");
    expect(formatPct(0.333)).toBe("33.3%");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.000123)).toBe("$0.00012");
    expect(formatUsd(1.5)).toBe("$1.50");
  });

  it("shows times in the business timezone", () => {
    // 2026-11-08 00:00 UTC is Saturday 7:00 PM in New York.
    expect(formatTime("2026-11-08T00:00:00.000Z")).toBe("Sat, Nov 7, 7:00 PM");
    expect(formatDay("2026-11-07")).toBe("Nov 7");
  });

  it("says how long ago", () => {
    const now = Date.parse("2026-11-04T19:00:00.000Z");
    expect(relativeTime("2026-11-04T18:59:30.000Z", now)).toBe("just now");
    expect(relativeTime("2026-11-04T18:45:00.000Z", now)).toBe("15 min ago");
    expect(relativeTime("2026-11-04T16:00:00.000Z", now)).toBe("3 h ago");
    expect(relativeTime("2026-11-01T19:00:00.000Z", now)).toBe("3 d ago");
  });

  it("reads the local wall time out of a slot id", () => {
    expect(formatSlot("2026-11-07T19:00@t4-1#4")).toBe("Sat, Nov 7, 7:00 PM");
    expect(formatSlot("not-a-slot")).toBe("not-a-slot");
  });
});
