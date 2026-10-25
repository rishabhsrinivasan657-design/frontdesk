import { Chip } from "@/components/dashboard/chips";
import { formatMs } from "@/dashboard/format";
import { STAGE_LABELS } from "@/dashboard/latency";
import type { Percentiles, Stage } from "@/dashboard/types";

const ORDER: Stage[] = ["firstOutput", "llmTtft", "tool", "stt", "ttsStart"];
const HINT: Record<Stage, string> = {
  firstOutput: "Caller's message to the first words back",
  llmTtft: "Model's first token",
  tool: "Each availability or booking lookup",
  stt: "Voice: end of speech to transcript",
  ttsStart: "Voice: reply text to audio",
};

function Bar({
  value,
  max,
  color,
  label,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <div className="relative h-2 flex-1">
        <div
          className="h-2 rounded-r-full"
          style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }}
        />
      </div>
      <span className="w-16 shrink-0 text-right text-xs font-medium tabular-nums">
        {formatMs(value)}
      </span>
    </div>
  );
}

/**
 * Each stage's p50 and p95 against its own spec §8 budget. Bullet bars instead of a shared-axis
 * chart, because every stage has a different budget (dashed ticks).
 */
export function StageBudget({
  latency,
  budget,
}: {
  latency: Record<Stage, Percentiles>;
  budget: Record<Stage, { p50: number; p95: number }>;
}) {
  return (
    <section
      className="rounded-xl border border-border bg-card p-5"
      aria-labelledby="stage-budget-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="stage-budget-title" className="text-base font-semibold">
            Latency by stage vs budget
          </h2>
          <p className="text-sm text-muted-foreground">
            Typical (p50) and slow-tail (p95) times for this period. Dashed ticks mark each
            stage&rsquo;s budget.
          </p>
        </div>
        <ul className="flex gap-4 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-chart-1" aria-hidden />
            p50
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-chart-2" aria-hidden />
            p95
          </li>
          <li className="flex items-center gap-1.5">
            <span
              className="h-3 border-l-2 border-dashed border-[var(--chart-budget)]"
              aria-hidden
            />
            budget
          </li>
        </ul>
      </div>
      <ul className="mt-4 flex flex-col divide-y divide-border">
        {ORDER.map((stage) => {
          const { p50, p95 } = latency[stage];
          const b = budget[stage];
          const max = Math.max(p95 ?? 0, b.p95) * 1.15;
          const over = p95 !== null && p95 > b.p95;
          return (
            <li
              key={stage}
              data-testid="stage-row"
              className="grid gap-2 py-3 sm:grid-cols-[200px_minmax(0,1fr)_120px] sm:items-center sm:gap-4"
            >
              <div>
                <p className="text-sm font-medium">{STAGE_LABELS[stage]}</p>
                <p className="text-xs text-muted-foreground">{HINT[stage]}</p>
              </div>
              {p50 === null || p95 === null ? (
                <p className="text-xs text-muted-foreground">No measurements in this period.</p>
              ) : (
                <div className="relative flex flex-col gap-1.5 pr-2">
                  {[b.p50, b.p95].map((t, i) => (
                    <span
                      key={i}
                      title={`${i === 0 ? "p50 target" : "p95 budget"}: ${formatMs(t)}`}
                      className="absolute top-[-4px] bottom-[-4px] border-l-2 border-dashed border-[var(--chart-budget)]"
                      style={{ left: `calc(2.5rem + (100% - 7.5rem) * ${t / max})` }}
                    />
                  ))}
                  <Bar value={p50} max={max} color="var(--chart-1)" label="p50" />
                  <Bar value={p95} max={max} color="var(--chart-2)" label="p95" />
                </div>
              )}
              <div className="sm:text-right">
                {p95 === null ? (
                  <Chip tone="neutral">No data</Chip>
                ) : over ? (
                  <Chip tone="bad" icon="alert">
                    Over budget
                  </Chip>
                ) : (
                  <Chip tone="good" icon="check">
                    Within budget
                  </Chip>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Budget {formatMs(b.p50)} / {formatMs(b.p95)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
