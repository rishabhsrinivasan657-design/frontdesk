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
  it("loads about 100 scenarios, at least 5 per category", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(95);
    expect(scenarios.length).toBeLessThanOrEqual(105);
    for (const c of CATEGORIES) {
      expect(scenarios.filter((s) => s.category === c).length, c).toBeGreaterThanOrEqual(5);
    }
  });

  it("the expiry scenario pauses longer than the 5-minute pending TTL", () => {
    const s = scenarios.find((x) => x.id === "policy-pending-expires")!;
    expect(s.seed.readbackPauseMinutes).toBeGreaterThan(5);
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

  /** The times check_availability offers in a scenario's seeded world. */
  async function offered(id: string, date: string, time: string, partySize: number) {
    const s = scenarios.find((x) => x.id === id);
    if (!s) throw new Error(`no scenario ${id}`);
    const { deps } = seedWorld(s, config, new TestLLM());
    const session = newSession("check", deps.clock.now());
    const result = await runReadTool(
      "check_availability",
      { date, time, partySize },
      { config, calendar: deps.calendar, clock: deps.clock, session },
    );
    if (!result.ok) throw new Error(result.message);
    return (result.data as { slots: { time: string }[] }).slots.map((x) => x.time);
  }

  it.each([
    "double-booking-full-slot",
    "reschedule-after-full-slot",
    "double-booking-move-into-full",
  ])("%s really has no table for 6 at 8pm Saturday", async (id) => {
    expect(await offered(id, "2026-11-07", "20:00", 6)).not.toContain("20:00");
  });

  it("reschedule-after-full-slot offers 8:30pm as the next later time", async () => {
    const times = await offered("reschedule-after-full-slot", "2026-11-07", "20:00", 6);
    expect(times).toContain("20:30");
    expect(times.filter((t) => t > "20:00" && t < "20:30")).toEqual([]);
  });

  it("double-booking-full-takes-later has no 7pm for 2 Friday and offers 8:30pm", async () => {
    const times = await offered("double-booking-full-takes-later", "2026-11-06", "19:00", 2);
    expect(times).not.toContain("19:00");
    expect(times).toContain("20:30");
    expect(times.filter((t) => t > "19:00" && t < "20:30")).toEqual([]);
  });

  it("double-booking-last-table still offers 7pm for 4 Saturday", async () => {
    expect(await offered("double-booking-last-table", "2026-11-07", "19:00", 4)).toContain("19:00");
  });
});
