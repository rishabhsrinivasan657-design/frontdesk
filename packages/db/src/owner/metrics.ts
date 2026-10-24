import { sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { type OwnerSource, rows, sourceIs } from "./shared.js";

/** The latency stages charted against the spec §8 budget. */
export type Stage = "stt" | "llmTtft" | "tool" | "ttsStart" | "firstOutput";
export interface Percentiles {
  p50: number | null;
  p95: number | null;
}

export interface DailyMetrics {
  /** Calendar day in the business timezone, YYYY-MM-DD. */
  day: string;
  conversations: number;
  taskSuccessRate: number | null;
  handoffRate: number | null;
  p50FirstOutputMs: number | null;
  p95FirstOutputMs: number | null;
  avgTokens: number | null;
  avgCostUsd: number | null;
}

export interface MetricsReport {
  summary: {
    conversations: number;
    /** Conversations with an executed write and no handoff (spec §10 task success). */
    taskSuccessRate: number | null;
    handoffRate: number | null;
    avgTokens: number | null;
    avgCostUsd: number | null;
    latency: Record<Stage, Percentiles>;
  };
  /** One entry per day of the window, oldest first, days without conversations included. */
  daily: DailyMetrics[];
  /** Seeded demo rows are in this window (live only: pilot never counts them). */
  hasSeeded: boolean;
}

const STAGE_COLUMNS = {
  stt: sql`t.stt_ms`,
  llmTtft: sql`t.llm_ttft_ms`,
  ttsStart: sql`t.tts_start_ms`,
  firstOutput: sql`t.first_output_ms`,
} as const;

const dayOf = (d: Date, timezone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, dateStyle: "short" }).format(d);

const rate = (n: number, of: number): number | null => (of === 0 ? null : n / of);

/**
 * Metrics over the conversations that started in the last `days` days and have a turn.
 * Percentiles are Postgres `percentile_cont` (linear interpolation).
 */
export async function metrics(
  db: Db,
  o: { source: OwnerSource; days: number; now: Date; timezone: string },
): Promise<MetricsReport> {
  const since = new Date(o.now.getTime() - o.days * 86_400_000).toISOString();
  const until = o.now.toISOString();
  const window = sql`${sourceIs(o.source)} and c.started_at > ${since} and c.started_at <= ${until}
    and exists (select 1 from turns t where t.conversation_id = c.id)`;
  const tz = o.timezone;

  const perDay = await rows<{
    day: string;
    conversations: number;
    successes: number;
    handoffs: number;
    tokens: number;
    cost: number;
    seeded: number;
  }>(
    db,
    sql`select to_char(c.started_at at time zone ${tz}, 'YYYY-MM-DD') as day,
      count(*)::int as conversations,
      count(*) filter (where c.outcome is distinct from 'handoff' and exists (
        select 1 from audit_log a where a.session_id = c.id and a.stage = 'executed'))::int
        as successes,
      count(*) filter (where c.outcome = 'handoff')::int as handoffs,
      coalesce(sum((select sum(t.tokens_in + t.tokens_out) from turns t
        where t.conversation_id = c.id)), 0)::float8 as tokens,
      coalesce(sum((select sum(t.cost_usd) from turns t where t.conversation_id = c.id)), 0)::float8
        as cost,
      count(*) filter (where c.seeded)::int as seeded
    from conversations c where ${window}
    group by 1`,
  );

  const stageSql = Object.entries(STAGE_COLUMNS).map(
    ([name, col]) =>
      sql`percentile_cont(0.5) within group (order by ${col}) as ${sql.raw(`"${name}_p50"`)},
        percentile_cont(0.95) within group (order by ${col}) as ${sql.raw(`"${name}_p95"`)}`,
  );
  const [stages] = await rows<Record<string, number | null>>(
    db,
    sql`select ${sql.join(stageSql, sql`, `)}
    from turns t join conversations c on c.id = t.conversation_id where ${window}`,
  );
  const [tools] = await rows<{ p50: number | null; p95: number | null }>(
    db,
    sql`select percentile_cont(0.5) within group (order by ms) as p50,
      percentile_cont(0.95) within group (order by ms) as p95
    from turns t join conversations c on c.id = t.conversation_id, unnest(t.tool_ms) as ms
    where ${window}`,
  );
  const firstOutputByDay = await rows<{ day: string; p50: number | null; p95: number | null }>(
    db,
    sql`select to_char(c.started_at at time zone ${tz}, 'YYYY-MM-DD') as day,
      percentile_cont(0.5) within group (order by t.first_output_ms) as p50,
      percentile_cont(0.95) within group (order by t.first_output_ms) as p95
    from turns t join conversations c on c.id = t.conversation_id where ${window}
    group by 1`,
  );

  const byDay = new Map(perDay.map((d) => [d.day, d]));
  const latencyByDay = new Map(firstOutputByDay.map((d) => [d.day, d]));
  const daily: DailyMetrics[] = [];
  for (let i = o.days - 1; i >= 0; i--) {
    const day = dayOf(new Date(o.now.getTime() - i * 86_400_000), tz);
    const d = byDay.get(day);
    const l = latencyByDay.get(day);
    const n = d?.conversations ?? 0;
    daily.push({
      day,
      conversations: n,
      taskSuccessRate: rate(d?.successes ?? 0, n),
      handoffRate: rate(d?.handoffs ?? 0, n),
      p50FirstOutputMs: l?.p50 ?? null,
      p95FirstOutputMs: l?.p95 ?? null,
      avgTokens: n ? d!.tokens / n : null,
      avgCostUsd: n ? d!.cost / n : null,
    });
  }

  const sum = (k: "conversations" | "successes" | "handoffs" | "tokens" | "cost" | "seeded") =>
    perDay.reduce((acc, d) => acc + d[k], 0);
  const conversations = sum("conversations");
  const p = (name: string): Percentiles => ({
    p50: stages?.[`${name}_p50`] ?? null,
    p95: stages?.[`${name}_p95`] ?? null,
  });
  return {
    summary: {
      conversations,
      taskSuccessRate: rate(sum("successes"), conversations),
      handoffRate: rate(sum("handoffs"), conversations),
      avgTokens: conversations ? sum("tokens") / conversations : null,
      avgCostUsd: conversations ? sum("cost") / conversations : null,
      latency: {
        stt: p("stt"),
        llmTtft: p("llmTtft"),
        tool: { p50: tools?.p50 ?? null, p95: tools?.p95 ?? null },
        ttsStart: p("ttsStart"),
        firstOutput: p("firstOutput"),
      },
    },
    daily,
    hasSeeded: sum("seeded") > 0,
  };
}
