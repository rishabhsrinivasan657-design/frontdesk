import type { Metadata } from "next";
import type React from "react";
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
  const resolved = Object.values(s.handoffOutcomes).reduce((n, c) => n + c, 0);
  const notNeeded = s.handoffOutcomes.not_needed ?? 0;

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
        <div className="flex flex-col gap-10">
          <Section
            title="Is it doing the job?"
            description={`Out of ${s.conversations.toLocaleString("en-US")} conversations in the last ${days} days.`}
          >
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
                label="Handed to you"
                value={formatPct(s.handoffRate)}
                tone={(s.handoffRate ?? 0) > 0.2 ? "warn" : "neutral"}
                detail={
                  resolved > 0
                    ? `${resolved - notNeeded} of ${resolved} resolved were really needed`
                    : "None resolved yet"
                }
              />
              <KpiTile
                testId="kpi"
                label="Guest rating"
                value={
                  s.feedback.avgRating === null ? "—" : `${s.feedback.avgRating.toFixed(1)} / 5`
                }
                detail={`${s.feedback.count.toLocaleString("en-US")} rated`}
              />
              <KpiTile
                testId="kpi"
                label="Unsafe actions"
                value={String(s.unsafeActions)}
                tone={s.unsafeActions === 0 ? "good" : "warn"}
                detail="Calendar writes without the guest's yes"
              />
            </div>
            <RatesChart data={m.daily} />
            <section
              aria-labelledby="outcomes-heading"
              className="rounded-xl border border-border bg-card px-5 py-4"
            >
              <h3 id="outcomes-heading" className="text-sm font-medium text-muted-foreground">
                How resolved handoffs ended
              </h3>
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(HANDOFF_OUTCOMES).map(([key, label]) => (
                  <div key={key} data-testid="handoff-outcome-count">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="text-lg font-semibold">{s.handoffOutcomes[key] ?? 0}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </Section>

          <Section
            title="What does it cost to run?"
            description="Front Desk runs on free tiers. Here is what the same traffic would cost on paid plans."
          >
            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <div className="rounded-xl border border-border bg-card px-5 py-2">
                <table className="w-full text-sm">
                  <tbody className="[&_td]:border-b [&_td]:border-muted [&_td]:py-2.5 [&_td:last-child]:text-right [&_td:last-child]:font-semibold [&_td:last-child]:tabular-nums [&_tr:last-child_td]:border-0">
                    <tr>
                      <td>AI model, per conversation (at paid prices)</td>
                      <td>{s.avgCostUsd === null ? "—" : formatUsd(s.avgCostUsd)}</td>
                    </tr>
                    <tr>
                      <td>Tokens per conversation</td>
                      <td>
                        {s.avgTokens === null
                          ? "—"
                          : Math.round(s.avgTokens).toLocaleString("en-US")}
                      </td>
                    </tr>
                    <tr>
                      <td>Conversations in this period</td>
                      <td>{s.conversations.toLocaleString("en-US")}</td>
                    </tr>
                    <tr>
                      <td>AI model for the whole period, if paid</td>
                      <td>
                        {s.avgCostUsd === null ? "—" : formatUsd(s.avgCostUsd * s.conversations)}
                      </td>
                    </tr>
                    <tr>
                      <td>Hosting, database, email</td>
                      <td>$0 (free tiers)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col justify-center gap-1 rounded-xl border border-success/30 bg-success-soft/50 px-5 py-4">
                <p className="text-sm text-muted-foreground">Spend cap</p>
                <p className="text-4xl font-bold text-success tabular-nums">$0.00</p>
                <p className="text-xs text-muted-foreground">
                  The model runs on its free tier with a $0 monthly cap. In production the server
                  refuses to start with any paid setting.
                </p>
              </div>
            </div>
            <div className="grid gap-6 xl:grid-cols-2">
              <TokensChart data={m.daily} />
              <CostChart data={m.daily} />
            </div>
          </Section>

          <Section
            title="How fast is it?"
            description="Each step of a reply, typical (p50) and slow-tail (p95), against its time budget."
          >
            <StageBudget latency={s.latency} budget={m.budget} />
            <FirstReplyChart data={m.daily} budget={m.budget.firstOutput} />
          </Section>
        </div>
      )}
    </>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
