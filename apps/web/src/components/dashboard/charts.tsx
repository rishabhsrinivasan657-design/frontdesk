"use client";

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { formatDay, formatMs, formatPct, formatUsd } from "@/dashboard/format";
import type { DailyMetrics } from "@/dashboard/types";

/** Series colors in fixed order (globals.css --chart-*), validated with the dataviz checks. */
const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"] as const;
const AXIS = { fontSize: 12, fill: "var(--muted-foreground)" };
const HEIGHT = 240;

interface Series {
  key: keyof DailyMetrics;
  label: string;
  color: string;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      {series.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function TooltipCard({
  label,
  rows,
}: {
  label: string;
  rows: { name: string; value: string; color: string }[];
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-foreground">{label}</p>
      {rows.map((r) => (
        <p key={r.name} className="flex items-center gap-2 text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: r.color }} aria-hidden />
          {r.name}
          <span className="ml-auto pl-4 font-medium text-foreground tabular-nums">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** A chart with its title, legend, and a table view of the same numbers (dataviz a11y). */
export function ChartCard({
  title,
  description,
  series,
  data,
  format,
  children,
}: {
  title: string;
  description: string;
  series: Series[];
  data: DailyMetrics[];
  format: (v: number | null) => string;
  children: ReactNode;
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <figcaption className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Legend series={series} />
      </figcaption>
      <div role="img" aria-label={`${title}. ${description}`} style={{ height: HEIGHT }}>
        {children}
      </div>
      <details className="text-sm">
        <summary className="w-fit text-xs font-medium text-muted-foreground select-none hover:text-foreground">
          Show data
        </summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 font-medium">
                  Day
                </th>
                {series.map((s) => (
                  <th key={s.label} scope="col" className="py-1 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className="py-1">{formatDay(d.day)}</td>
                  {series.map((s) => (
                    <td key={s.label} className="py-1 text-right tabular-nums">
                      {format(d[s.key] as number | null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function tooltipFor(series: Series[], format: (v: number | null) => string) {
  return function ChartTooltip({
    active,
    payload,
    label,
  }: TooltipContentProps<ValueType, NameType>) {
    const d = payload?.[0]?.payload as DailyMetrics | undefined;
    if (!active || !d) return null;
    return (
      <TooltipCard
        label={`${formatDay(String(label))} · ${d.conversations} ${d.conversations === 1 ? "conversation" : "conversations"}`}
        rows={series.map((s) => ({
          name: s.label,
          value: format(d[s.key] as number | null),
          color: s.color,
        }))}
      />
    );
  };
}

const xAxis = (
  <XAxis
    dataKey="day"
    tickFormatter={formatDay}
    tick={AXIS}
    tickLine={false}
    axisLine={false}
    minTickGap={24}
  />
);
const grid = <CartesianGrid vertical={false} stroke="var(--chart-grid)" />;

export function RatesChart({ data }: { data: DailyMetrics[] }) {
  const series: Series[] = [
    { key: "taskSuccessRate", label: "Task success", color: SERIES[0] },
    { key: "handoffRate", label: "Handoff rate", color: SERIES[1] },
  ];
  return (
    <ChartCard
      title="Task success and handoffs"
      description="Share of each day's conversations that ended in a booking, and that were handed to you."
      series={series}
      data={data}
      format={formatPct}
    >
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          {grid}
          {xAxis}
          <YAxis
            domain={[0, 1]}
            tickFormatter={(v: number) => formatPct(v)}
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            content={tooltipFor(series, formatPct)}
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          />
          {series.map((s) => (
            <Line
              key={s.label}
              type="linear"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={{ r: 2.5, strokeWidth: 0, fill: s.color }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function FirstReplyChart({
  data,
  budget,
}: {
  data: DailyMetrics[];
  budget: { p50: number; p95: number };
}) {
  const series: Series[] = [
    { key: "p50FirstOutputMs", label: "Typical (p50)", color: SERIES[0] },
    { key: "p95FirstOutputMs", label: "Slow tail (p95)", color: SERIES[1] },
  ];
  const label = (text: string) => ({
    value: text,
    position: "insideTopRight" as const,
    fontSize: 11,
    fill: "var(--chart-budget)",
  });
  return (
    <ChartCard
      title="Time to first reply"
      description={`How long guests wait for Front Desk to start answering. Dashed lines: the ${formatMs(budget.p50)} target and ${formatMs(budget.p95)} budget.`}
      series={series}
      data={data}
      format={formatMs}
    >
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          {grid}
          {xAxis}
          <YAxis
            tickFormatter={(v: number) => formatMs(v)}
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={56}
            domain={[0, (max: number) => Math.max(max, budget.p95) * 1.1]}
          />
          <Tooltip
            content={tooltipFor(series, formatMs)}
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          />
          <ReferenceLine
            y={budget.p50}
            stroke="var(--chart-budget)"
            strokeDasharray="4 4"
            label={label("p50 target")}
          />
          <ReferenceLine
            y={budget.p95}
            stroke="var(--chart-budget)"
            strokeDasharray="4 4"
            label={label("p95 budget")}
          />
          {series.map((s) => (
            <Line
              key={s.label}
              type="linear"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={{ r: 2.5, strokeWidth: 0, fill: s.color }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function SingleBarChart({
  data,
  series,
  title,
  description,
  format,
}: {
  data: DailyMetrics[];
  series: Series;
  title: string;
  description: string;
  format: (v: number | null) => string;
}) {
  return (
    <ChartCard
      title={title}
      description={description}
      series={[series]}
      data={data}
      format={format}
    >
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          {grid}
          {xAxis}
          <YAxis
            tickFormatter={(v: number) => format(v)}
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={60}
          />
          <Tooltip
            content={tooltipFor([series], format)}
            cursor={{ fill: "var(--secondary)", opacity: 0.5 }}
          />
          <Bar
            dataKey={series.key}
            name={series.label}
            fill={series.color}
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

const tokens = (v: number | null) => (v === null ? "—" : Math.round(v).toLocaleString("en-US"));
const usd = (v: number | null) => (v === null ? "—" : formatUsd(v));

export function TokensChart({ data }: { data: DailyMetrics[] }) {
  return (
    <SingleBarChart
      data={data}
      series={{ key: "avgTokens", label: "Tokens per conversation", color: SERIES[0] }}
      title="Tokens per conversation"
      description="Average input + output tokens the model used per conversation, by day."
      format={tokens}
    />
  );
}

export function CostChart({ data }: { data: DailyMetrics[] }) {
  return (
    <SingleBarChart
      data={data}
      series={{ key: "avgCostUsd", label: "Cost per conversation", color: SERIES[2] }}
      title="Cost per conversation"
      description="Average model cost per conversation, by day (the free tier costs $0)."
      format={usd}
    />
  );
}
