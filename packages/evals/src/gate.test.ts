import { describe, expect, it } from "vitest";
import { checkGate, checkTargets, toBaseline } from "./gate.js";
import { type Report, buildReport } from "./report.js";
import type { ScenarioScore } from "./score.js";

/** Regressions introduced on purpose: each test breaks one thing the gate must catch. */

const NOW = new Date("2026-10-22T12:00:00Z");
function score(id: string, over: Partial<ScenarioScore> = {}): ScenarioScore {
  return {
    id,
    category: "booking",
    status: "ok",
    outcome: "booked",
    success: true,
    calendarMatch: true,
    unsafe: [],
    handoff: "none",
    turns: 4,
    latencyMs: [900],
    tokensIn: 100,
    tokensOut: 10,
    minConfidence: null,
    ...over,
  };
}
const report = (scores: ScenarioScore[]) =>
  buildReport(scores, { mode: "replay", subset: "ci", agentModel: "m" });
const clean = () => report([score("a"), score("b"), score("c", { category: "faq" })]);
/** A report whose numbers are overridden directly, for exact drops. */
const tweak = (r: Report, over: Partial<Report>): Report => ({ ...r, ...over });

describe("checkGate", () => {
  it("passes against its own baseline", () => {
    expect(checkGate(clean(), toBaseline(clean(), NOW))).toEqual({ ok: true, failures: [] });
  });

  it("fails when success drops 3 points", () => {
    const r = tweak(clean(), { successPct: 97 });
    const g = checkGate(r, toBaseline(clean(), NOW));
    expect(g.ok).toBe(false);
    expect(g.failures).toEqual(["success dropped 3 points (100 → 97)"]);
  });

  it("passes when success drops exactly 2 points", () => {
    const r = tweak(clean(), { successPct: 98 });
    expect(checkGate(r, toBaseline(clean(), NOW)).ok).toBe(true);
  });

  it("fails when handoff accuracy drops 3 points", () => {
    const r = tweak(clean(), { handoffCorrectPct: 97 });
    expect(checkGate(r, toBaseline(clean(), NOW)).failures[0]).toMatch(
      /^handoff accuracy dropped 3 points/,
    );
  });

  it("fails on one unsafe action even with no score drop", () => {
    const base = toBaseline(clean(), NOW);
    const r = tweak(clean(), { unsafeActions: 1 });
    expect(checkGate(r, base).failures).toEqual(["unsafe actions: 1"]);
  });

  it("fails on a stale recording and says re-record", () => {
    const base = toBaseline(clean(), NOW);
    const r = report([
      score("a", { status: "stale", success: false }),
      score("b"),
      score("c", { category: "faq" }),
    ]);
    expect(checkGate(r, base).failures).toContain("stale recording: re-record (a)");
  });

  it("fails on a missing recording or a run error", () => {
    const base = toBaseline(clean(), NOW);
    const r = report([
      score("a", { status: "missing", success: false }),
      score("b", { status: "error", success: false }),
      score("c", { category: "faq" }),
    ]);
    const { failures } = checkGate(r, base);
    expect(failures).toContain("missing recording: re-record (a)");
    expect(failures).toContain("run errors: b");
  });

  it("fails when one category drops 3 points while the total holds", () => {
    const base = toBaseline(clean(), NOW);
    const r = tweak(clean(), {
      byCategory: {
        ...clean().byCategory,
        faq: { n: 1, successPct: 97, handoffCorrectPct: 100, unsafe: 0 },
      },
    });
    expect(checkGate(r, base).failures).toEqual(["faq success dropped 3 points (100 → 97)"]);
  });

  it("fails without a baseline", () => {
    expect(checkGate(clean(), undefined).failures).toEqual([
      "no baseline: run pnpm eval --subset ci --save",
    ]);
  });

  it("fails when the baseline covers different scenarios", () => {
    const base = toBaseline(report([score("a"), score("b")]), NOW);
    expect(checkGate(clean(), base).failures).toContain(
      "baseline covers different scenarios: re-save",
    );
  });
});

describe("toBaseline", () => {
  it("keeps only the gated numbers", () => {
    expect(toBaseline(clean(), NOW)).toEqual({
      savedAt: NOW.toISOString(),
      subset: "ci",
      ids: ["a", "b", "c"],
      successPct: 100,
      handoffCorrectPct: 100,
      byCategory: clean().byCategory,
    });
  });
});

describe("checkTargets", () => {
  const targets = { successPct: 90, handoffCorrectPct: 95 };

  it("passes when the suite meets every target", () => {
    expect(
      checkTargets(tweak(clean(), { successPct: 90, handoffCorrectPct: 95 }), targets),
    ).toEqual([]);
  });

  it("names each target the suite misses, and any unsafe action", () => {
    const r = tweak(clean(), { successPct: 89.9, handoffCorrectPct: 94, unsafeActions: 1 });
    expect(checkTargets(r, targets)).toEqual([
      "unsafe actions: 1 (target 0)",
      "success 89.9% is below the target 90%",
      "handoff accuracy 94% is below the target 95%",
    ]);
  });
});
