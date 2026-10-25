import { describe, expect, it } from "vitest";
import { buildReport, confidenceSweep, formatScoreboard, percentile } from "./report.js";
import type { ScenarioScore } from "./score.js";

function score(over: Partial<ScenarioScore> = {}): ScenarioScore {
  return {
    id: "s",
    category: "booking",
    status: "ok",
    outcome: "booked",
    success: true,
    calendarMatch: true,
    unsafe: [],
    handoff: "none",
    turns: 4,
    latencyMs: [1000],
    tokensIn: 1000,
    tokensOut: 100,
    minConfidence: null,
    ...over,
  };
}
const META = {
  mode: "replay" as const,
  agentModel: "gemini-3.5-flash-lite",
  price: { input: 0.3, output: 2.5 },
};

describe("buildReport", () => {
  it("aggregates success, unsafe and handoff counts", () => {
    const r = buildReport(
      [
        score({ id: "a" }),
        score({ id: "b", success: false, handoff: "missed" }),
        score({ id: "c", category: "handoff", handoff: "correct", outcome: "handoff" }),
        score({
          id: "d",
          category: "injection",
          success: false,
          handoff: "unnecessary",
          unsafe: [{ kind: "extra_event", detail: "x" }],
          status: "stale",
        }),
      ],
      META,
    );
    expect(r).toMatchObject({
      n: 4,
      successPct: 50,
      handoffCorrectPct: 50,
      unsafeActions: 1,
      missedHandoffs: 1,
      unnecessaryHandoffs: 1,
      statuses: { ok: 3, stale: 1, missing: 0, quota: 0, error: 0 },
      ids: ["a", "b", "c", "d"],
      subset: null,
    });
    expect(r.tokensPerConv).toBe(1100);
    expect(r.costPerConvUsd).toBeCloseTo((1000 * 0.3 + 100 * 2.5) / 1e6, 9);
  });

  it("computes nearest-rank p50/p95", () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 95)).toBe(0);
    const r = buildReport(
      [score({ latencyMs: [100, 200] }), score({ latencyMs: [300, 4000], turns: 8 })],
      META,
    );
    expect(r).toMatchObject({ latencyP50Ms: 200, latencyP95Ms: 4000, turnsAvg: 6, turnsP95: 8 });
  });

  it("breaks results down per category", () => {
    const r = buildReport([score(), score({ success: false }), score({ category: "faq" })], META);
    expect(r.byCategory.booking).toEqual({
      n: 2,
      successPct: 50,
      handoffCorrectPct: 100,
      unsafe: 0,
    });
    expect(r.byCategory.faq).toMatchObject({ n: 1, successPct: 100 });
    expect(r.byCategory.angry).toBeUndefined();
  });

  it("rounds percentages to one decimal", () => {
    const r = buildReport([score(), score(), score({ success: false })], META);
    expect(r.successPct).toBe(66.7);
  });
});

describe("formatScoreboard", () => {
  it("lists every category present, the totals and the latency warning", () => {
    const r = buildReport([score({ latencyMs: [5000] }), score({ category: "faq", id: "f" })], {
      ...META,
      subset: "ci",
    });
    const out = formatScoreboard(r);
    for (const s of [
      "booking",
      "faq",
      "Task success",
      "100.0%",
      "Unsafe actions",
      "0",
      "warning only",
      "over budget",
    ]) {
      expect(out).toContain(s);
    }
    expect(out).not.toContain("angry");
  });
});

describe("confidenceSweep", () => {
  it("counts the runs a higher threshold would hand off, split by whether a handoff was expected", () => {
    const scores = [
      score({ id: "a", minConfidence: 0.3, handoff: "missed" }),
      score({ id: "b", minConfidence: 0.55 }),
      score({ id: "c", minConfidence: null }),
    ];
    expect(confidenceSweep(scores, [0.6])).toEqual([
      { threshold: 0.6, wouldHandOff: 2, ofWhichExpected: 1, ofWhichUnnecessary: 1 },
    ]);
  });

  it("is printed on the scoreboard", () => {
    const text = formatScoreboard(buildReport([score({ minConfidence: 0.55 })], META));
    expect(text).toMatch(/Confidence/);
    expect(text).toMatch(/< 0\.6\s+1 runs/);
  });
});
