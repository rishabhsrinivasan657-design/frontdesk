import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BusinessConfigError } from "@frontdesk/core";
import { loadBusinessConfig } from "./business-config.js";

const casaFiorella = resolve(import.meta.dirname, "../../../businesses/casa-fiorella.yaml");

describe("loadBusinessConfig", () => {
  it("loads casa-fiorella.yaml with the spec's values", () => {
    const config = loadBusinessConfig(casaFiorella);

    expect(config.business.timezone).toBe("America/New_York");
    expect(config.hours.mon).toEqual([]);
    expect(config.hours.tue).toEqual([{ open: "17:00", close: "22:00" }]);
    expect(config.hours.fri).toEqual([{ open: "17:00", close: "23:00" }]);
    expect(config.hours.sun).toEqual([{ open: "12:00", close: "21:00" }]);
    expect(config.seating.tables).toEqual([
      { size: 2, count: 8 },
      { size: 4, count: 6 },
      { size: 6, count: 2 },
    ]);
    // Spec §2 says "50 seats", but its own table list (8×2, 6×4, 2×6) is 52; the tables win.
    expect(config.seating.tables.reduce((seats, t) => seats + t.size * t.count, 0)).toBe(52);
    expect(config.seating.holdMinutes).toEqual({ default: 90, partyOf5Plus: 120 });
    expect(config.seating.slotIntervalMinutes).toBe(15);
    expect(config.seating.lastSeatingBeforeCloseMinutes).toBe(60);
    expect(config.policies).toEqual({
      bookingWindowDays: 30,
      minLeadMinutes: 60,
      maxPartyForAgent: 8,
      freeChangeUntilHoursBefore: 4,
      graceMinutes: 15,
    });
    expect(config.privateRoom).toEqual({
      name: "La Cantina",
      min: 10,
      max: 30,
      agentMayBook: false,
    });
    expect([...config.handoffTriggers].sort()).toEqual(
      [
        "private_event",
        "party_too_large",
        "allergy_safety",
        "complaint",
        "human_requested",
        "late_change",
      ].sort(),
    );
    expect(config.faq.map((f) => f.id)).toEqual(
      expect.arrayContaining([
        "parking",
        "kids",
        "dietary",
        "corkage",
        "patio",
        "gift-cards",
        "dress-code",
        "accessibility",
      ]),
    );
  });

  it("throws BusinessConfigError naming the path for a missing file", () => {
    const missing = resolve(import.meta.dirname, "does-not-exist.yaml");
    expect(() => loadBusinessConfig(missing)).toThrow(BusinessConfigError);
    expect(() => loadBusinessConfig(missing)).toThrow(missing);
  });
});
