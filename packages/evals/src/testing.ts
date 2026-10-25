import type { LLMChunk } from "@frontdesk/core";
import type { FakeStep } from "@frontdesk/llm";
import { type Scenario, ScenarioSchema } from "./scenario.js";

/** Test helpers: a scripted booking conversation for the fake agent and fake caller. */

export const text = (t: string): LLMChunk => ({ type: "text", text: t });
export const call = (id: string, name: string, args: Record<string, unknown>): LLMChunk => ({
  type: "tool_call",
  call: { id, name, args },
});
export const usage: LLMChunk = { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } };
export const say = (s: string, done = false): FakeStep => ({ generate: { say: s, done } });

export function scenario(
  overrides: Partial<Omit<Scenario, "expect">> & { expect?: Partial<Scenario["expect"]> } = {},
): Scenario {
  const { expect, ...rest } = overrides;
  return ScenarioSchema.parse({
    id: "book-saturday",
    category: "booking",
    persona: "Bo Chen, email bo@example.com",
    goal: "A table for 4 this Saturday at 7pm",
    seed: { now: "2026-11-04T14:00:00-05:00", reservations: [] },
    ...rest,
    expect: {
      outcome: "booked",
      calendar: [{ name: "Bo Chen", start: "2026-11-07T19:00", party: 4 }],
      ...expect,
    },
  });
}

/** Agent steps that check availability, propose the booking, then (after "yes") just talk. */
export function bookingAgentSteps(): FakeStep[] {
  const steps: LLMChunk[][] = [
    [call("c1", "check_availability", { date: "2026-11-07", time: "19:00", partySize: 4 })],
    [text("That time is open. What name and email should I use?")],
    [
      call("c2", "book", {
        slotId: "2026-11-07T19:00@t4-1#4",
        name: "Bo Chen",
        contact: "bo@example.com",
        partySize: 4,
      }),
    ],
    [text("See you Saturday!")],
    [text("See you Saturday!")],
  ];
  return steps.map((chunks) => ({ stream: [...chunks, usage] }));
}

export function bookingCallerSteps(): FakeStep[] {
  return [
    say("Hi, a table for 4 this Saturday at 7pm?"),
    say("Bo Chen, bo@example.com"),
    say("Yes"),
    say("Thanks, bye!", true),
  ];
}
