import { describe, it } from "vitest";
import { ALL_STEPS, run } from "./exhaustive-harness.js";

describe("confirmation gate, exhaustively", () => {
  it("every 2-step sequence from pendingCancel matches the reference model", async () => {
    for (const a of ALL_STEPS) {
      for (const b of ALL_STEPS) await run("pendingCancel", [a, b]);
    }
  }, 300_000);
});
