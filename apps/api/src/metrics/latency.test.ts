import { describe, expect, it } from "vitest";
import { LATENCY_P95_MS, overBudgetFlags } from "./latency.js";

describe("overBudgetFlags", () => {
  it("flags each stage over p95", () => {
    expect(overBudgetFlags({ llmTtftMs: 1501, toolMs: [10, 801], firstOutputMs: 1801 })).toEqual([
      "over_p95_llm_ttft",
      "over_p95_tool",
      "over_p95_first_token",
    ]);
  });

  it("a turn exactly at budget is not flagged", () => {
    expect(
      overBudgetFlags({
        llmTtftMs: LATENCY_P95_MS.llmTtft,
        toolMs: [LATENCY_P95_MS.tool],
        firstOutputMs: LATENCY_P95_MS.chatFirstToken,
      }),
    ).toEqual([]);
  });

  it("flags voice stages over p95: STT 800 ms, TTS start 300 ms", () => {
    expect(overBudgetFlags({ toolMs: [], sttMs: 801, ttsStartMs: 301 })).toEqual([
      "over_p95_stt",
      "over_p95_tts_start",
    ]);
    expect(overBudgetFlags({ toolMs: [], sttMs: 800, ttsStartMs: 300 })).toEqual([]);
  });

  it("a turn without an LLM call has no ttft flag", () => {
    expect(overBudgetFlags({ toolMs: [] })).toEqual([]);
  });
});
