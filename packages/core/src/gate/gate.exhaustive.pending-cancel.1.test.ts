import { describe, it } from "vitest";
import { runPairs } from "./exhaustive-harness.js";

describe("confirmation gate, exhaustively", () => {
  it("every 2-step sequence from pendingCancel (shard 1/2) matches the reference model", async () => {
    await runPairs("pendingCancel", 0, 2);
  }, 300_000);
});
