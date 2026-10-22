import { describe, expect, it } from "vitest";
import { msUntilPacificMidnight, pacificDay, utcMonth } from "./time.js";

describe("pacificDay", () => {
  it("23:59 PST still belongs to that day", () => {
    expect(pacificDay(Date.parse("2026-11-03T07:59:00Z"))).toBe("2026-11-02");
  });

  it("00:00 PST starts the next day (not UTC midnight)", () => {
    expect(pacificDay(Date.parse("2026-11-03T08:00:00Z"))).toBe("2026-11-03");
    expect(pacificDay(Date.parse("2026-11-03T00:30:00Z"))).toBe("2026-11-02");
  });

  it("uses PDT in summer", () => {
    expect(pacificDay(Date.parse("2026-07-01T06:59:00Z"))).toBe("2026-06-30");
    expect(pacificDay(Date.parse("2026-07-01T07:00:00Z"))).toBe("2026-07-01");
  });
});

describe("msUntilPacificMidnight", () => {
  it("counts down to the next Pacific midnight", () => {
    expect(msUntilPacificMidnight(Date.parse("2026-11-03T07:59:00Z"))).toBe(60_000);
    expect(msUntilPacificMidnight(Date.parse("2026-07-01T07:00:00Z"))).toBe(86_400_000);
  });
});

describe("utcMonth", () => {
  it("formats YYYY-MM in UTC", () => {
    expect(utcMonth(Date.parse("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(utcMonth(Date.parse("2026-11-01T00:00:00Z"))).toBe("2026-11");
  });
});
