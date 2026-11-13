import { describe, expect, it } from "vitest";
import { nextStep, whatTheyWant } from "./handoff-guidance";

describe("handoff card text", () => {
  it("tells the owner what to do for each reason, with a fallback", () => {
    expect(nextStep("party_too_large")).toMatch(/call them back/i);
    expect(nextStep("allergy_safety")).toMatch(/kitchen/i);
    expect(nextStep("something_new")).toMatch(/read the conversation/i);
  });

  it("uses the model's summary as is", () => {
    expect(whatTheyWant("A table for 12 on Saturday for a birthday.")).toEqual({
      kind: "summary",
      text: "A table for 12 on Saturday for a birthday.",
    });
  });

  it("turns the fallback summary into the guest's own last words", () => {
    expect(whatTheyWant("Handoff (human_requested) after: can I talk to a manager?")).toEqual({
      kind: "quote",
      text: "can I talk to a manager?",
    });
  });
});
