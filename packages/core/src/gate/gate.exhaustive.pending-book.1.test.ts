import { describe, it } from "vitest";
import { runPairs } from "./exhaustive-harness.js";

describe("confirmation gate, exhaustively", () => {
  it("every 2-step sequence from pendingBook (shard 1/2) matches the reference model", async () => {
    await runPairs("pendingBook", 0, 2);
  }, 300_000);
});
