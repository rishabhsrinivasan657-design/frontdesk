import type { Price } from "@frontdesk/llm";
import { RUN_STATUSES, type RunStatus } from "./run.js";
import { CATEGORIES, type Category } from "./scenario.js";
import type { ScenarioScore } from "./score.js";

export type Mode = "live" | "record" | "replay";

export interface CategoryScore {
  n: number;
  successPct: number;
  handoffCorrectPct: number;
  unsafe: number;
}

export interface Report {
  mode: Mode;
  subset: string | null;
  agentModel: string;
  ids: string[];
  n: number;
  successPct: number;
  handoffCorrectPct: number;
  unsafeActions: number;
  missedHandoffs: number;
  unnecessaryHandoffs: number;
  turnsAvg: number;
  turnsP95: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  tokensPerConv: number;
  /** What the agent's tokens would cost on the paid tier (free tier is $0). */
  costPerConvUsd: number;
  statuses: Record<RunStatus, number>;
  byCategory: Partial<Record<Category, CategoryScore>>;
  scenarios: ScenarioScore[];
}

export interface ReportMeta {
  mode: Mode;
  subset?: string;
  agentModel: string;
  price?: Price;
}

/** Chat-with-tools budget (spec §8); latency is a warning, never a gate. */
export const LATENCY_BUDGET_MS = { p50: 1800, p95: 3500 };

const round1 = (x: number) => Math.round(x * 10) / 10;
const pct = (part: number, whole: number) => (whole === 0 ? 0 : round1((100 * part) / whole));
const handoffOk = (s: ScenarioScore) => s.handoff === "correct" || s.handoff === "none";

/** Nearest-rank percentile; 0 for no values. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

export function buildReport(scores: ScenarioScore[], meta: ReportMeta): Report {
  const n = scores.length;
  const latencies = scores.flatMap((s) => s.latencyMs);
  const turns = scores.map((s) => s.turns);
  const tokensIn = scores.reduce((sum, s) => sum + s.tokensIn, 0);
  const tokensOut = scores.reduce((sum, s) => sum + s.tokensOut, 0);
  const cost = meta.price ? (tokensIn * meta.price.input + tokensOut * meta.price.output) / 1e6 : 0;

  const byCategory: Partial<Record<Category, CategoryScore>> = {};
  for (const category of CATEGORIES) {
    const group = scores.filter((s) => s.category === category);
    if (group.length === 0) continue;
    byCategory[category] = {
      n: group.length,
      successPct: pct(group.filter((s) => s.success).length, group.length),
      handoffCorrectPct: pct(group.filter(handoffOk).length, group.length),
      unsafe: group.reduce((sum, s) => sum + s.unsafe.length, 0),
    };
  }

  const statuses = Object.fromEntries(RUN_STATUSES.map((st) => [st, 0])) as Record<
    RunStatus,
    number
  >;
  for (const s of scores) statuses[s.status] += 1;

  return {
    mode: meta.mode,
    subset: meta.subset ?? null,
    agentModel: meta.agentModel,
    ids: scores.map((s) => s.id),
    n,
    successPct: pct(scores.filter((s) => s.success).length, n),
    handoffCorrectPct: pct(scores.filter(handoffOk).length, n),
    unsafeActions: scores.reduce((sum, s) => sum + s.unsafe.length, 0),
    missedHandoffs: scores.filter((s) => s.handoff === "missed").length,
    unnecessaryHandoffs: scores.filter((s) => s.handoff === "unnecessary").length,
    turnsAvg: n === 0 ? 0 : round1(turns.reduce((a, b) => a + b, 0) / n),
    turnsP95: percentile(turns, 95),
    latencyP50Ms: Math.round(percentile(latencies, 50)),
    latencyP95Ms: Math.round(percentile(latencies, 95)),
    tokensPerConv: n === 0 ? 0 : Math.round((tokensIn + tokensOut) / n),
    costPerConvUsd: n === 0 ? 0 : cost / n,
    statuses,
    byCategory,
    scenarios: scores,
  };
}

const row = (cells: (string | number)[], widths: number[]) =>
  cells
    .map((c, i) => String(c).padEnd(widths[i]!))
    .join("  ")
    .trimEnd();

export function formatScoreboard(r: Report): string {
  const widths = [16, 4, 9, 11, 7];
  const lines = [
    `Front Desk evals — ${r.mode}${r.subset ? ` (subset: ${r.subset})` : ""} — agent ${r.agentModel} — ${r.n} scenarios`,
    "",
    row(["category", "n", "success", "handoff ok", "unsafe"], widths),
    row(["-".repeat(16), "--", "-------", "----------", "------"], widths),
  ];
  for (const [category, c] of Object.entries(r.byCategory)) {
    lines.push(
      row(
        [
          category,
          c.n,
          `${c.successPct.toFixed(1)}%`,
          `${c.handoffCorrectPct.toFixed(1)}%`,
          c.unsafe,
        ],
        widths,
      ),
    );
  }
  const overBudget =
    r.latencyP50Ms > LATENCY_BUDGET_MS.p50 || r.latencyP95Ms > LATENCY_BUDGET_MS.p95;
  lines.push(
    "",
    `Task success      ${r.successPct.toFixed(1)}%`,
    `Unsafe actions    ${r.unsafeActions}`,
    `Handoffs correct  ${r.handoffCorrectPct.toFixed(1)}%  (missed ${r.missedHandoffs}, unnecessary ${r.unnecessaryHandoffs})`,
    `Turns             avg ${r.turnsAvg}, p95 ${r.turnsP95}`,
    `Latency           p50 ${r.latencyP50Ms} ms, p95 ${r.latencyP95Ms} ms (warning only${overBudget ? `; over budget ${LATENCY_BUDGET_MS.p50}/${LATENCY_BUDGET_MS.p95} ms` : ""})`,
    `Tokens/conv       ${r.tokensPerConv}  (≈ $${r.costPerConvUsd.toFixed(5)} if paid)`,
  );
  const problems = RUN_STATUSES.filter((s) => s !== "ok" && r.statuses[s] > 0);
  if (problems.length > 0) {
    lines.push(`Not scored        ${problems.map((s) => `${s} ${r.statuses[s]}`).join(", ")}`);
    for (const s of r.scenarios.filter((x) => x.status !== "ok"))
      lines.push(`  - ${s.id}: ${s.status}`);
  }
  const failed = r.scenarios.filter((s) => s.status === "ok" && !s.success);
  if (failed.length > 0) {
    lines.push("Failed scenarios");
    for (const s of failed) {
      const why = [
        `outcome ${s.outcome}`,
        s.calendarMatch ? "" : "calendar differs",
        s.handoff === "none" || s.handoff === "correct" ? "" : `handoff ${s.handoff}`,
        ...s.unsafe.map((u) => `UNSAFE ${u.kind}: ${u.detail}`),
      ].filter(Boolean);
      lines.push(`  - ${s.id}: ${why.join("; ")}`);
    }
  }
  return lines.join("\n");
}
