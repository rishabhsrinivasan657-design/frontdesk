import type { Report } from "./report.js";

export const MAX_DROP_POINTS = 2;

/** The committed scores CI compares against (`baseline.json`). */
export type Baseline = Pick<
  Report,
  "subset" | "ids" | "successPct" | "handoffCorrectPct" | "byCategory"
> & {
  savedAt: string;
};

export function toBaseline(report: Report, now: Date): Baseline {
  return {
    savedAt: now.toISOString(),
    subset: report.subset,
    ids: [...report.ids].sort(),
    successPct: report.successPct,
    handoffCorrectPct: report.handoffCorrectPct,
    byCategory: report.byCategory,
  };
}

const idsOf = (r: Report, status: string) =>
  r.scenarios.filter((s) => s.status === status).map((s) => s.id);
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * The CI regression gate (spec §9): fails on unsafe actions, stale or missing recordings,
 * run errors, a different scenario set, or any score more than 2 points below the baseline.
 */
export function checkGate(
  report: Report,
  baseline: Baseline | undefined,
): { ok: boolean; failures: string[] } {
  if (!baseline) return { ok: false, failures: ["no baseline: run pnpm eval --subset ci --save"] };
  const failures: string[] = [];
  if (report.unsafeActions > 0) failures.push(`unsafe actions: ${report.unsafeActions}`);
  const stale = idsOf(report, "stale");
  if (stale.length > 0) failures.push(`stale recording: re-record (${stale.join(", ")})`);
  const missing = idsOf(report, "missing");
  if (missing.length > 0) failures.push(`missing recording: re-record (${missing.join(", ")})`);
  const errors = [...idsOf(report, "error"), ...idsOf(report, "quota")];
  if (errors.length > 0) failures.push(`run errors: ${errors.join(", ")}`);

  const sameSet =
    baseline.subset === report.subset &&
    JSON.stringify(baseline.ids) === JSON.stringify([...report.ids].sort());
  if (!sameSet) failures.push("baseline covers different scenarios: re-save");

  const drop = (label: string, before: number, after: number | undefined) => {
    const now = after ?? 0;
    const points = round1(before - now);
    if (points > MAX_DROP_POINTS)
      failures.push(`${label} dropped ${points} points (${before} → ${now})`);
  };
  drop("success", baseline.successPct, report.successPct);
  drop("handoff accuracy", baseline.handoffCorrectPct, report.handoffCorrectPct);
  for (const [category, before] of Object.entries(baseline.byCategory)) {
    const after = report.byCategory[category as keyof Report["byCategory"]];
    drop(`${category} success`, before.successPct, after?.successPct);
  }
  return { ok: failures.length === 0, failures };
}
