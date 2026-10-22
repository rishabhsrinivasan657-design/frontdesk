import { describe, it } from "vitest";
import { runPairs } from "./exhaustive-harness.js";

describe("confirmation gate, exhaustively", () => {
  it("every 2-step sequence from none (shard 1/2) matches the reference model", async () => {
    await runPairs("none", 0, 2);
  }, 300_000);
});
