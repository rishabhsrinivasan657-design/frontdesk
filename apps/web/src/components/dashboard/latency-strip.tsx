import { Icon } from "@/components/icons";
import { formatMs } from "@/dashboard/format";
import { BUDGET, type TurnStage, turnStages } from "@/dashboard/latency";
import type { TurnRecord } from "@/dashboard/types";
import { cn } from "@/lib/utils";

const STYLE = {
  ok: "border-border bg-card text-muted-foreground",
  warn: "border-warning/40 bg-warning-soft text-warning",
  over: "border-critical/40 bg-critical-soft text-critical",
  none: "",
} as const;

function describe(s: TurnStage): string {
  const b = BUDGET[s.key];
  const verdict =
    s.status === "over"
      ? `over the ${formatMs(b.p95)} p95 budget`
      : s.status === "warn"
        ? `slower than the ${formatMs(b.p50)} p50 target, within the ${formatMs(b.p95)} p95 budget`
        : `within the ${formatMs(b.p50)} p50 target`;
  return `${s.label}: ${formatMs(s.ms)}, ${verdict}`;
}

/** One turn's per-stage latency against the spec §8 budget; over-budget stages say so in words. */
export function LatencyStrip({ turn }: { turn: TurnRecord }) {
  const stages = turnStages(turn);
  if (stages.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Latency for this turn">
      {stages.map((s, i) => (
        <li
          key={`${s.key}-${i}`}
          title={describe(s)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
            STYLE[s.status],
          )}
        >
          {s.key === "tool" && <Icon name="tool" className="size-3" />}
          {s.status === "over" && <Icon name="alert" className="size-3" />}
          <span>{s.label}</span>
          <span className="font-semibold">{formatMs(s.ms)}</span>
          <span className="sr-only">{describe(s)}</span>
        </li>
      ))}
    </ul>
  );
}
