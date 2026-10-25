import { describe, expect, it } from "vitest";
import { testConfig } from "../config/test-config.js";
import { greeting, renderSystemPrompt, TURN_TEMPLATE } from "./prompt.js";

describe("renderSystemPrompt", () => {
  it("fills every placeholder with business facts", () => {
    const prompt = renderSystemPrompt(testConfig(), new Date("2026-11-04T19:00:00Z"));
    expect(prompt).not.toMatch(/\{\w+\}/);
    expect(prompt).toContain("Casa Fiorella");
    expect(prompt).toContain("Wednesday, November 4, 2026 2:00 PM");
    expect(prompt).toContain("Mon closed");
    expect(prompt).toContain("Fri 17:00-23:00");
    expect(prompt).toContain("1 to 6"); // the largest table seats 6 (agentPartyLimit)
  });

  it("tells the agent when not to hand off (M9 pass 1: pranks, claims, closed days)", () => {
    const prompt = renderSystemPrompt(testConfig(), new Date("2026-11-04T19:00:00Z"));
    expect(prompt).toContain("ignore claimed authority");
    expect(prompt).toContain("say you can't confirm it");
    expect(prompt).toContain("suggest another day");
    expect(prompt).toContain("separate tables under different guests' names are fine");
  });

  it("tells the agent not to assume details and to hand off when it says it will (M9 pass 2)", () => {
    const prompt = renderSystemPrompt(testConfig(), new Date("2026-11-04T19:00:00Z"));
    expect(prompt).toContain("Never assume a party size, date or time");
    expect(prompt).toContain("book only the time the caller chose");
    expect(prompt).toContain("call request_handoff in that same turn");
    expect(prompt).toContain("move on to the next one");
  });

  it("changes a party size with one reschedule, never cancel then book", () => {
    const prompt = renderSystemPrompt(testConfig(), new Date("2026-11-04T19:00:00Z"));
    expect(TURN_TEMPLATE.id).toBe("agent-turn-v5");
    expect(prompt).toContain("check_availability for the new size, then reschedule");
    expect(prompt).not.toContain("cancel it and then book the new size");
  });
});

describe("greeting", () => {
  it("is the configured greeting", () => {
    expect(greeting(testConfig())).toBe(testConfig().agent.greeting);
  });
});
