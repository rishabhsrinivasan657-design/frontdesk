import type { Metadata } from "next";
import Link from "next/link";
import { CostChart, FirstReplyChart, RatesChart, TokensChart } from "@/components/dashboard/charts";
import { EmptyState, KpiTile, PageHeader } from "@/components/dashboard/page";
import { HANDOFF_OUTCOMES } from "@/dashboard/handoff-outcomes";
import { StageBudget } from "@/components/dashboard/stage-budget";
import { formatPct, formatUsd } from "@/dashboard/format";
import { type MetricsReport, sourceParam } from "@/dashboard/types";
import { ownerFetch } from "@/lib/owner-api";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Metrics" };
const RANGES = [7, 30, 90] as const;

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const source = sourceParam(params.source);
  const days = RANGES.find((d) => String(d) === params.days) ?? 30;
  const m = await ownerFetch<MetricsReport>(`/metrics?source=${source}&days=${days}`);
  const href = (d: number) => {
    const q = new URLSearchParams({ days: String(d) });
    if (source === "pilot") q.set("source", "pilot");
    return `/dashboard/metrics?${q}`;
  };
  const s = m.summary;

  return (
    <>
      <PageHeader
        title="Metrics"
        description={
          source === "pilot"
            ? "Real guests during the pilot. Demo and eval data never count here."
            : "How Front Desk is doing: bookings, handoffs, speed and cost."
        }
        actions={
          <>
            {m.hasSeeded && (
              <span
                data-testid="demo-pill"
                title="Seeded demo conversations are included in live numbers; they never count under pilot."
                className="rounded-full border border-accent/40 px-3 py-1 text-xs font-semibold text-accent"
              >
                Includes demo data
              </span>
            )}
            <nav
              aria-label="Time range"
              className="inline-flex rounded-lg border border-border bg-card p-0.5"
            >
              {RANGES.map((d) => (
                <Link
                  key={d}
                  href={href(d)}
                  aria-current={d === days ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-1 text-sm font-medium transition-colors duration-200",
                    d === days
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d} days
                </Link>
              ))}
            </nav>
          </>
        }
      />

      {s.conversations === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon="metrics"
            title={
              source === "pilot" ? "No pilot conversations yet" : "No conversations in this period"
            }
          >
            {source === "pilot"
              ? "Pilot numbers appear once real guests start using Front Desk. Demo and eval data never count here."
              : "Numbers appear once guests start talking to Front Desk."}
          </EmptyState>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
            <KpiTile
              testId="kpi"
              label="Conversations"
              value={s.conversations.toLocaleString("en-US")}
              detail={`Last ${days} days`}
            />
            <KpiTile
              testId="kpi"
              label="Task success"
              value={formatPct(s.taskSuccessRate)}
              tone="good"
              detail="Ended with a confirmed booking"
            />
            <KpiTile
              testId="kpi"
              label="Handoff rate"
              value={formatPct(s.handoffRate)}
              tone={(s.handoffRate ?? 0) > 0.2 ? "warn" : "neutral"}
              detail="Passed to you"
            />
            <KpiTile
              testId="kpi"
              label="Guest rating"
              value={s.feedback.avgRating === null ? "—" : `${s.feedback.avgRating.toFixed(1)} / 5`}
              detail={`${s.feedback.count.toLocaleString("en-US")} rated`}
            />
            <KpiTile
              testId="kpi"
              label="Cost per conversation"
              value={s.avgCostUsd === null ? "—" : formatUsd(s.avgCostUsd)}
              detail={
                s.avgTokens === null
                  ? undefined
                  : `${Math.round(s.avgTokens).toLocaleString("en-US")} tokens on average`
              }
            />
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <RatesChart data={m.daily} />
            <FirstReplyChart data={m.daily} budget={m.budget.firstOutput} />
          </div>
          <StageBudget latency={s.latency} budget={m.budget} />
          <section
            aria-labelledby="outcomes-heading"
            className="rounded-xl border border-border bg-card px-5 py-4"
          >
            <h2 id="outcomes-heading" className="text-sm font-medium text-muted-foreground">
              Resolved handoff outcomes
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(HANDOFF_OUTCOMES).map(([key, label]) => (
                <div key={key} data-testid="handoff-outcome-count">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-semibold">{s.handoffOutcomes[key] ?? 0}</dd>
                </div>
              ))}
            </dl>
          </section>
          <div className="grid gap-6 xl:grid-cols-2">
            <TokensChart data={m.daily} />
            <CostChart data={m.daily} />
          </div>
        </div>
      )}
    </>
  );
}
