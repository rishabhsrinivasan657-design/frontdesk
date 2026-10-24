import type { TurnResult } from "@frontdesk/core";
import type { TurnRecord } from "@frontdesk/db";
import { type Price, costUsd } from "@frontdesk/llm";
import { overBudgetFlags } from "./latency.js";

export interface TurnRecordInput {
  id: string;
  conversationId: string;
  turnIndex: number;
  callerText: string;
  result: TurnResult;
  /** Browser timestamps in ms (voice only, M7). */
  timings: { speechEnd?: number; sttFinal?: number };
  /** Server time from receiving the caller's text to the first reply message. */
  firstOutputMs?: number;
  /** Server time from sending the first sentence to hearing that speech started (M7). */
  ttsStartMs?: number;
  price: Price;
  now: Date;
}

/** The spec §8 per-turn record, built from the loop's `turn_metrics` message. */
export function toTurnRecord(input: TurnRecordInput): TurnRecord {
  const metrics = input.result.messages.find((m) => m.type === "turn_metrics");
  if (metrics?.type !== "turn_metrics") throw new Error("turn has no turn_metrics message");
  const { speechEnd, sttFinal } = input.timings;
  const round = (ms: number | undefined) => (ms === undefined ? null : Math.round(ms));
  const sttMs =
    speechEnd !== undefined && sttFinal !== undefined ? Math.round(sttFinal - speechEnd) : null;
  return {
    id: input.id,
    conversationId: input.conversationId,
    turnIndex: input.turnIndex,
    callerText: input.callerText,
    agentText: input.result.reply,
    sttMs,
    llmTtftMs: round(metrics.llmTtftMs),
    llmTotalMs: round(metrics.llmTotalMs),
    toolMs: metrics.toolMs.map(Math.round),
    ttsStartMs: round(input.ttsStartMs),
    firstOutputMs: round(input.firstOutputMs),
    toolCalls: input.result.toolCalls.map((c) => ({ ...c, ms: Math.round(c.ms) })),
    totalMs: round(metrics.totalMs),
    tokensIn: metrics.tokensIn,
    tokensOut: metrics.tokensOut,
    costUsd: costUsd(
      { inputTokens: metrics.tokensIn, outputTokens: metrics.tokensOut },
      input.price,
    ),
    flags: [
      ...input.result.flags,
      ...overBudgetFlags({
        ...(metrics.llmTtftMs !== undefined ? { llmTtftMs: metrics.llmTtftMs } : {}),
        toolMs: metrics.toolMs,
        ...(input.firstOutputMs !== undefined ? { firstOutputMs: input.firstOutputMs } : {}),
        ...(sttMs !== null ? { sttMs } : {}),
        ...(input.ttsStartMs !== undefined ? { ttsStartMs: input.ttsStartMs } : {}),
      }),
    ],
    createdAt: input.now.toISOString(),
  };
}
