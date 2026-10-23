/** Spec §8 p95 budget: chat first token 1.8 s, LLM time to first token 1.5 s, each tool 0.8 s. */
export const LATENCY_P95_MS = { llmTtft: 1500, tool: 800, chatFirstToken: 1800 } as const;

export type LatencyFlag = "over_p95_llm_ttft" | "over_p95_tool" | "over_p95_first_token";

/** The stages of one turn that went over their p95 budget (equal is within budget). */
export function overBudgetFlags(m: {
  llmTtftMs?: number;
  toolMs: number[];
  firstOutputMs?: number;
}): LatencyFlag[] {
  const flags: LatencyFlag[] = [];
  if (m.llmTtftMs !== undefined && m.llmTtftMs > LATENCY_P95_MS.llmTtft) {
    flags.push("over_p95_llm_ttft");
  }
  if (m.toolMs.some((ms) => ms > LATENCY_P95_MS.tool)) flags.push("over_p95_tool");
  if (m.firstOutputMs !== undefined && m.firstOutputMs > LATENCY_P95_MS.chatFirstToken) {
    flags.push("over_p95_first_token");
  }
  return flags;
}
