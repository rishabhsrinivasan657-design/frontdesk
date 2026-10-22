import type { BusinessConfig } from "./schema.js";

/** Casa Fiorella's values as a fresh object, for tests that mutate it. Not exported from the package. */
export function testConfig(): BusinessConfig {
  return {
    business: {
      name: "Casa Fiorella",
      phone: "+1-555-010-4477",
      email: "hello@casafiorella.example.com",
      address: "112 Mulberry Lane, Brooklyn, NY 11201",
      timezone: "America/New_York",
    },
    hours: {
      sun: [{ open: "12:00", close: "21:00" }],
      mon: [],
      tue: [{ open: "17:00", close: "22:00" }],
      wed: [{ open: "17:00", close: "22:00" }],
      thu: [{ open: "17:00", close: "22:00" }],
      fri: [{ open: "17:00", close: "23:00" }],
      sat: [{ open: "17:00", close: "23:00" }],
    },
    closures: [
      { date: "2026-11-26", reason: "Thanksgiving" },
      { date: "2026-12-25", reason: "Christmas" },
    ],
    seating: {
      tables: [
        { size: 2, count: 8 },
        { size: 4, count: 6 },
        { size: 6, count: 2 },
      ],
      holdMinutes: { default: 90, partyOf5Plus: 120 },
      slotIntervalMinutes: 15,
      lastSeatingBeforeCloseMinutes: 60,
    },
    policies: {
      bookingWindowDays: 30,
      minLeadMinutes: 60,
      maxPartyForAgent: 8,
      freeChangeUntilHoursBefore: 4,
      graceMinutes: 15,
    },
    privateRoom: { name: "La Cantina", min: 10, max: 30, agentMayBook: false },
    menu: [{ item: "Cacio e pepe", price: 22, tags: ["vegetarian"] }],
    faq: [{ id: "parking", q: "Is there parking?", a: "Street parking only.", keywords: ["park"] }],
    handoffTriggers: [
      "private_event",
      "party_too_large",
      "allergy_safety",
      "complaint",
      "human_requested",
      "late_change",
    ],
    agent: {
      persona: "Warm, brief host at a family trattoria.",
      greeting: "Casa Fiorella, how can I help?",
      voice: { lang: "en-US", rate: 1 },
    },
  };
}
