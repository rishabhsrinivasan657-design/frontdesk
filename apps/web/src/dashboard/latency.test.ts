import { describe, expect, it } from "vitest";
import { BUDGET, stageStatus, turnStages } from "./latency";

describe("stageStatus", () => {
  it("is ok up to p50, warn up to p95, over above p95 (equal is within)", () => {
    expect(stageStatus(800, "firstOutput")).toBe("ok");
    expect(stageStatus(801, "firstOutput")).toBe("warn");
    expect(stageStatus(1800, "firstOutput")).toBe("warn");
    expect(stageStatus(1801, "firstOutput")).toBe("over");
    expect(stageStatus(null, "tool")).toBe("none");
  });

  it("mirrors the spec §8 budget", () => {
    expect(BUDGET).toEqual({
      stt: { p50: 400, p95: 800 },
      llmTtft: { p50: 700, p95: 1500 },
      tool: { p50: 300, p95: 800 },
      ttsStart: { p50: 150, p95: 300 },
      firstOutput: { p50: 800, p95: 1800 },
    });
  });
});

describe("turnStages", () => {
  it("lists the measured stages of a turn, tools by name, skipping unmeasured voice stages", () => {
    const stages = turnStages({
      firstOutputMs: 900,
      llmTtftMs: 650,
      sttMs: null,
      ttsStartMs: null,
      toolCalls: [{ name: "check_availability", ms: 120, ok: true }],
    });
    expect(stages).toEqual([
      { key: "firstOutput", label: "First reply", ms: 900, status: "warn" },
      { key: "llmTtft", label: "LLM first token", ms: 650, status: "ok" },
      { key: "tool", label: "check_availability", ms: 120, status: "ok" },
    ]);
  });
});
