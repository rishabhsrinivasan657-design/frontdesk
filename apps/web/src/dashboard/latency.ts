import type { Stage, ToolCall } from "./types";

/**
 * Spec §8 latency budget, in ms. The api sends the same numbers with /owner/metrics
 * (apps/api/src/owner/routes.ts BUDGET); per-turn views use this copy.
 */
export const BUDGET: Record<Stage, { p50: number; p95: number }> = {
  stt: { p50: 400, p95: 800 },
  llmTtft: { p50: 700, p95: 1500 },
  tool: { p50: 300, p95: 800 },
  ttsStart: { p50: 150, p95: 300 },
  firstOutput: { p50: 800, p95: 1800 },
};

export const STAGE_LABELS: Record<Stage, string> = {
  firstOutput: "First reply",
  llmTtft: "LLM first token",
  tool: "Tool calls",
  stt: "Speech to text",
  ttsStart: "Speech start",
};

export type StageStatus = "ok" | "warn" | "over" | "none";

/** Within p50 is ok, within p95 is a warning, beyond p95 is over budget (flagged, spec §8). */
export function stageStatus(ms: number | null | undefined, stage: Stage): StageStatus {
  if (ms === null || ms === undefined) return "none";
  if (ms <= BUDGET[stage].p50) return "ok";
  return ms <= BUDGET[stage].p95 ? "warn" : "over";
}

export interface TurnStage {
  key: Stage;
  label: string;
  ms: number;
  status: StageStatus;
}

/** A turn's measured stages in reading order: reply, model, each tool, then voice stages. */
export function turnStages(t: {
  firstOutputMs: number | null;
  llmTtftMs: number | null;
  sttMs: number | null;
  ttsStartMs: number | null;
  toolCalls: ToolCall[];
}): TurnStage[] {
  const out: TurnStage[] = [];
  const add = (key: Stage, label: string, ms: number | null) => {
    if (ms !== null) out.push({ key, label, ms, status: stageStatus(ms, key) });
  };
  add("firstOutput", STAGE_LABELS.firstOutput, t.firstOutputMs);
  add("llmTtft", STAGE_LABELS.llmTtft, t.llmTtftMs);
  for (const call of t.toolCalls) add("tool", call.name, call.ms);
  add("stt", STAGE_LABELS.stt, t.sttMs);
  add("ttsStart", STAGE_LABELS.ttsStart, t.ttsStartMs);
  return out;
}
