import { describe, it } from "vitest";
import { ALL_STEPS, run } from "./exhaustive-harness.js";

describe("confirmation gate, randomized", () => {
  it("2000 seeded random sequences of 3–6 steps match the reference model", async () => {
    let state = 0x5eed_2026;
    const rand = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const initials = ["none", "pendingBook", "pendingCancel"] as const;
    for (let i = 0; i < 2000; i++) {
      const length = 3 + Math.floor(rand() * 4);
      const steps = Array.from({ length }, () => ALL_STEPS[Math.floor(rand() * ALL_STEPS.length)]!);
      await run(initials[i % 3]!, steps);
    }
  }, 300_000);
});
