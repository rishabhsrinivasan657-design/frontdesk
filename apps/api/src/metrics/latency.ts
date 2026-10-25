/**
 * Spec §8 p95 budget: chat first token 1.8 s, LLM time to first token 1.5 s, each tool 0.8 s,
 * STT finalization 0.8 s, TTS start 0.3 s.
 */
export const LATENCY_P95_MS = {
  llmTtft: 1500,
  tool: 800,
  chatFirstToken: 1800,
  stt: 800,
  ttsStart: 300,
} as const;

/** Spec §8 p50 budget: the typical turn the dashboard charts against. */
export const LATENCY_P50_MS = {
  llmTtft: 700,
  tool: 300,
  chatFirstToken: 800,
  stt: 400,
  ttsStart: 150,
} as const;

export type LatencyFlag =
  | "over_p95_llm_ttft"
  | "over_p95_tool"
  | "over_p95_first_token"
  | "over_p95_stt"
  | "over_p95_tts_start";

/** The stages of one turn that went over their p95 budget (equal is within budget). */
export function overBudgetFlags(m: {
  llmTtftMs?: number;
  toolMs: number[];
  firstOutputMs?: number;
  sttMs?: number;
  ttsStartMs?: number;
}): LatencyFlag[] {
  const flags: LatencyFlag[] = [];
  if (m.llmTtftMs !== undefined && m.llmTtftMs > LATENCY_P95_MS.llmTtft) {
    flags.push("over_p95_llm_ttft");
  }
  if (m.toolMs.some((ms) => ms > LATENCY_P95_MS.tool)) flags.push("over_p95_tool");
  if (m.firstOutputMs !== undefined && m.firstOutputMs > LATENCY_P95_MS.chatFirstToken) {
    flags.push("over_p95_first_token");
  }
  if (m.sttMs !== undefined && m.sttMs > LATENCY_P95_MS.stt) flags.push("over_p95_stt");
  if (m.ttsStartMs !== undefined && m.ttsStartMs > LATENCY_P95_MS.ttsStart) {
    flags.push("over_p95_tts_start");
  }
  return flags;
}
