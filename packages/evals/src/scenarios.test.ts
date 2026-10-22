import { TestLLM } from "@frontdesk/core/testing";
import { newSession, runReadTool } from "@frontdesk/core";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { SCENARIOS_DIR } from "./paths.js";
import { CATEGORIES, loadScenarios } from "./scenario.js";
import { seedWorld } from "./seed.js";

const config = loadConfig();
const scenarios = await loadScenarios(SCENARIOS_DIR);

describe("committed scenarios", () => {
  it("loads about 15 scenarios covering all 11 categories", () => {
    expect(scenarios.length).toBe(15);
    expect(new Set(scenarios.map((s) => s.category))).toEqual(new Set(CATEGORIES));
  });

  it("every handoff scenario names its reason, and only handoff scenarios do", () => {
    for (const s of scenarios) {
      expect(s.expect.handoffReason !== null, s.id).toBe(s.expect.outcome === "handoff");
    }
  });

  it("every seed fits the floor plan", () => {
    for (const s of scenarios)
      expect(() => seedWorld(s, config, new TestLLM()), s.id).not.toThrow();
  });

  it("every persona that must look up a booking states the contact on it", () => {
    for (const s of scenarios) {
      for (const r of s.seed.reservations) {
        if (!s.persona.includes(r.name)) continue;
        const contact = r.contact ?? `${r.name.split(" ")[0]!.toLowerCase()}@example.com`;
        expect(s.persona, s.id).toContain(contact);
      }
    }
  });

  it("the full-slot scenario really has no table for 6 at 8pm Saturday", async () => {
    const s = scenarios.find((x) => x.id === "double-booking-full-slot")!;
    const { deps } = seedWorld(s, config, new TestLLM());
    const session = newSession("check", deps.clock.now());
    const result = await runReadTool(
      "check_availability",
      { date: "2026-11-07", time: "20:00", partySize: 6 },
      { config, calendar: deps.calendar, clock: deps.clock, session },
    );
    if (!result.ok) throw new Error(result.message);
    const slots = (result.data as { slots: { time: string }[] }).slots;
    expect(slots.map((x) => x.time)).not.toContain("20:00");
  });
});
