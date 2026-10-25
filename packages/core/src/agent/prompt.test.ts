import { describe, expect, it } from "vitest";
import { testConfig } from "../config/test-config.js";
import { greeting, renderSystemPrompt } from "./prompt.js";

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
});

describe("greeting", () => {
  it("is the configured greeting", () => {
    expect(greeting(testConfig())).toBe(testConfig().agent.greeting);
  });
});
