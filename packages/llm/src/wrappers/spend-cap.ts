import {
  LLMError,
  type LLMChunk,
  type LLMProvider,
  type LLMRequest,
  type Usage,
} from "@frontdesk/core";
import type { ZodType } from "zod";
import type { SpendStore } from "../stores/types.js";
import { utcMonth } from "../time.js";

export interface Price {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens (thinking included). */
  output: number;
}

export interface SpendCapOptions {
  store: SpendStore;
  tier: "free" | "paid";
  capUsd: number;
  price: Price;
  now?: () => number;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

/** USD for the given token usage at a per-1M-token price. */
export function costUsd(usage: Usage, price: Price): number {
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

function projectedUsage(req: LLMRequest): Usage {
  const chars =
    req.system.length +
    JSON.stringify(req.messages).length +
    JSON.stringify(req.tools ?? []).length;
  return {
    inputTokens: Math.ceil(chars / 4),
    outputTokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };
}

/** Worst-case cost of a call before it runs: ~4 chars per input token plus the full output budget. */
export function projectCostUsd(req: LLMRequest, price: Price): number {
  return costUsd(projectedUsage(req), price);
}

/**
 * Spend cap (spec §7 wrapper 1): paid calls that would pass SPEND_CAP_USD_MONTHLY fail closed.
 * Free calls are never blocked, but their tokens and paid-equivalent cost are still recorded.
 */
export function withSpendCap(inner: LLMProvider, options: SpendCapOptions): LLMProvider {
  const { store, tier, capUsd, price, now = Date.now } = options;

  async function check(req: LLMRequest): Promise<void> {
    if (tier === "free") return;
    const spent = await store.get(utcMonth(now()));
    const projected = projectCostUsd(req, price);
    if (spent.usd + projected > capUsd) {
      throw new LLMError(
        "spend_cap",
        `Monthly spend cap $${capUsd} reached (spent $${spent.usd.toFixed(4)}, next call ≈ $${projected.toFixed(4)})`,
      );
    }
  }

  async function record(usage: Usage): Promise<void> {
    const cost = costUsd(usage, price);
    await store.add(utcMonth(now()), {
      usd: tier === "paid" ? cost : 0,
      shadowUsd: cost,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
  }

  return {
    model: inner.model,
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      await check(req);
      let usage: Usage | undefined;
      let started = false;
      try {
        for await (const chunk of inner.stream(req)) {
          started = true;
          if (chunk.type === "usage") usage = chunk.usage;
          yield chunk;
        }
      } finally {
        // A stream abandoned before its usage chunk is charged at the projection, never at zero.
        if (usage) await record(usage);
        else if (started) await record(projectedUsage(req));
      }
    },
    async generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }> {
      await check(req);
      const result = await inner.generate(req, schema);
      await record(result.usage);
      return result;
    },
  };
}
