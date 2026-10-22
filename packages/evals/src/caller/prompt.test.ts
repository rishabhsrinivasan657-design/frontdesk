import { describe, expect, it } from "vitest";
import { ScenarioSchema } from "../scenario.js";
import { CALLER_TEMPLATE, callerRequest } from "./prompt.js";

const scenario = ScenarioSchema.parse({
  id: "s",
  category: "handoff",
  persona: "Nervous diner named Kim Park, email kim@example.com",
  goal: "Ask whether the burrata is safe for a severe nut allergy",
  seed: { now: "2026-11-04T14:00:00-05:00" },
  expect: {
    outcome: "handoff",
    handoffReason: "allergy_safety",
    calendar: [{ name: "Zed Secret", start: "2031-01-01T05:55", party: 3 }],
  },
});

describe("callerRequest", () => {
  it("never puts expect into the caller request", () => {
    const text = JSON.stringify(callerRequest(scenario, [{ role: "agent", text: "Hi!" }]));
    for (const leak of ["allergy_safety", "Zed Secret", "2031-01-01", "outcome", "handoff"]) {
      expect(text).not.toContain(leak);
    }
    expect(text).toContain("Kim Park");
    expect(text).toContain("severe nut allergy");
  });

  it("flips roles in the transcript", () => {
    const req = callerRequest(scenario, [
      { role: "agent", text: "Hello, Casa Fiorella." },
      { role: "caller", text: "Hi, quick question." },
      { role: "agent", text: "Sure." },
    ]);
    expect(req.messages).toEqual([
      { role: "user", text: "Hello, Casa Fiorella." },
      { role: "assistant", text: "Hi, quick question." },
      { role: "user", text: "Sure." },
    ]);
    expect(req.template).toBe(CALLER_TEMPLATE);
    expect(req.template.id).toBe("caller-sim");
  });

  it("is deterministic for the same input", () => {
    const t = [{ role: "agent" as const, text: "Hi" }];
    expect(callerRequest(scenario, t)).toEqual(callerRequest(scenario, t));
  });
});
