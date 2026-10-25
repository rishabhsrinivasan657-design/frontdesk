import type { TurnResult } from "@frontdesk/core";
import { describe, expect, it } from "vitest";
import { toTurnRecord } from "./turn-record.js";

const result: TurnResult = {
  turnId: "turn_1",
  reply: "Hello.",
  flags: ["injection_pattern"],
  messages: [
    { type: "agent_sentence", turnId: "turn_1", text: "Hello." },
    {
      type: "turn_metrics",
      turnId: "turn_1",
      llmTtftMs: 2000.4,
      llmTotalMs: 2500.6,
      toolMs: [12.2, 900],
      totalMs: 3100.5,
      tokensIn: 1_000_000,
      tokensOut: 500_000,
    },
  ],
  toolCalls: [{ name: "check_availability", ms: 12.2, ok: true }],
};

const base = {
  id: "turn_1",
  conversationId: "sess_1",
  turnIndex: 1,
  callerText: "Hi",
  result,
  timings: {},
  price: { input: 0.1, output: 0.4 },
  now: new Date("2026-11-04T19:00:00Z"),
};

describe("toTurnRecord", () => {
  it("stores toolCalls and firstOutputMs", () => {
    const r = toTurnRecord({ ...base, firstOutputMs: 812.4 });
    expect(r.firstOutputMs).toBe(812);
    expect(r.toolCalls).toEqual([{ name: "check_availability", ms: 12, ok: true }]);
    expect(toTurnRecord(base).firstOutputMs).toBeNull();
  });

  it("copies metrics from turn_metrics, rounded to whole ms", () => {
    const r = toTurnRecord({ ...base, firstOutputMs: 900 });
    expect(r).toMatchObject({
      id: "turn_1",
      conversationId: "sess_1",
      turnIndex: 1,
      callerText: "Hi",
      agentText: "Hello.",
      llmTtftMs: 2000,
      llmTotalMs: 2501,
      toolMs: [12, 900],
      totalMs: 3101,
      tokensIn: 1_000_000,
      tokensOut: 500_000,
      ttsStartMs: null,
      createdAt: "2026-11-04T19:00:00.000Z",
    });
  });

  it("computes stt from both timings, null otherwise", () => {
    expect(toTurnRecord({ ...base, timings: { speechEnd: 100, sttFinal: 450 } }).sttMs).toBe(350);
    expect(toTurnRecord({ ...base, timings: { sttFinal: 450 } }).sttMs).toBeNull();
  });

  it("stores tts start and flags slow voice stages", () => {
    const row = toTurnRecord({
      ...base,
      timings: { speechEnd: 100, sttFinal: 1000 },
      ttsStartMs: 350.4,
    });
    expect(row.ttsStartMs).toBe(350);
    expect(row.flags).toEqual(expect.arrayContaining(["over_p95_stt", "over_p95_tts_start"]));
  });

  it("prices tokens with the catalog price", () => {
    expect(toTurnRecord(base).costUsd).toBeCloseTo(0.1 + 0.2, 10);
  });

  it("adds over-budget flags to the loop's flags", () => {
    expect(toTurnRecord({ ...base, firstOutputMs: 2000 }).flags).toEqual([
      "injection_pattern",
      "over_p95_llm_ttft",
      "over_p95_tool",
      "over_p95_first_token",
    ]);
  });

  it("a turn with no LLM call stores a null ttft", () => {
    const noLlm: TurnResult = {
      ...result,
      messages: [
        {
          type: "turn_metrics",
          turnId: "turn_1",
          llmTotalMs: 0,
          toolMs: [],
          totalMs: 5,
          tokensIn: 0,
          tokensOut: 0,
        },
      ],
    };
    expect(toTurnRecord({ ...base, result: noLlm }).llmTtftMs).toBeNull();
  });
});
