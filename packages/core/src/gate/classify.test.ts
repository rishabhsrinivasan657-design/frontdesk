import { describe, expect, it } from "vitest";
import type { PendingAction } from "../agent/types.js";
import { LLMError } from "../llm/errors.js";
import { TestLLM } from "../testing/test-llm.js";
import { CONFIRM_PHRASES, DENY_PHRASES, classifyConfirmation, ruleDecision } from "./classify.js";

const action: PendingAction = {
  id: "act_1",
  sessionId: "s1",
  args: { kind: "cancel", reservationId: "res_ana" },
  summary:
    "To confirm: cancel your reservation for 4 on Friday, November 6 at 7:00 PM. Shall I cancel it?",
  proposedTurn: 1,
  expiresAt: "2026-11-04T19:05:00.000Z",
};

describe("ruleDecision", () => {
  it.each(CONFIRM_PHRASES.map((p) => [p]))("%s confirms", (phrase) => {
    expect(ruleDecision(phrase)).toBe("confirm");
    expect(ruleDecision(`  ${phrase.toUpperCase()}!! `)).toBe("confirm");
  });

  it.each(DENY_PHRASES.map((p) => [p]))("%s denies", (phrase) => {
    expect(ruleDecision(phrase)).toBe("deny");
    expect(ruleDecision(`${phrase}.`)).toBe("deny");
  });

  it.each(["yes but make it 8pm", "no, Saturday instead", "what about parking", "yesterday", ""])(
    "%j is not a clear yes or no",
    (text) => {
      expect(ruleDecision(text)).toBeUndefined();
    },
  );
});

describe("classifyConfirmation", () => {
  it("uses the rule without calling the LLM", async () => {
    const llm = new TestLLM();
    expect(await classifyConfirmation(llm, action, "Yes.")).toEqual({
      decision: "confirm",
      source: "rule",
    });
    expect(await classifyConfirmation(llm, action, "nope")).toEqual({
      decision: "deny",
      source: "rule",
    });
    expect(llm.calls).toEqual([]);
  });

  it("asks the LLM with purpose confirmation for anything else", async () => {
    const llm = new TestLLM().onGenerate(() => ({ decision: "change", confidence: 0.9 }));
    expect(await classifyConfirmation(llm, action, "yes but make it 8pm")).toEqual({
      decision: "change",
      source: "llm",
    });
    expect(llm.calls).toHaveLength(1);
    const req = llm.calls[0]!.req;
    expect(llm.calls[0]!.mode).toBe("generate");
    expect(req.purpose).toBe("confirmation");
    expect(req.temperature).toBe(0);
    expect(req.system).toContain(action.summary);
    expect(req.messages).toEqual([
      { role: "user", text: "<caller_message>\nyes but make it 8pm\n</caller_message>" },
    ]);
  });

  it("treats a low-confidence confirm as unrelated", async () => {
    const llm = new TestLLM().onGenerate(() => ({ decision: "confirm", confidence: 0.4 }));
    expect(await classifyConfirmation(llm, action, "I guess maybe")).toEqual({
      decision: "unrelated",
      source: "llm",
    });
  });

  it("accepts a confirm at exactly the threshold", async () => {
    const llm = new TestLLM().onGenerate(() => ({ decision: "confirm", confidence: 0.5 }));
    expect((await classifyConfirmation(llm, action, "yes go for it")).decision).toBe("confirm");
  });

  it("treats an LLM error as unrelated", async () => {
    const llm = new TestLLM().failWith(new LLMError("upstream", "down", { status: 503 }));
    expect(await classifyConfirmation(llm, action, "sure thing friend")).toEqual({
      decision: "unrelated",
      source: "llm",
      error: true,
    });
  });

  it("treats invalid output as unrelated", async () => {
    const llm = new TestLLM().onGenerate(() => ({ decision: "absolutely" }));
    expect(await classifyConfirmation(llm, action, "sure thing friend")).toMatchObject({
      decision: "unrelated",
      error: true,
    });
  });
});
