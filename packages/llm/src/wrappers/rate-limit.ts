import {
  LLMError,
  type LLMChunk,
  type LLMProvider,
  type LLMRequest,
  type Usage,
} from "@frontdesk/core";
import type { ZodType } from "zod";
import type { RateLimitStore, RateLimits } from "../stores/types.js";
import { msUntilPacificMidnight, pacificDay } from "../time.js";

export interface RateLimitOptions {
  store: RateLimitStore;
  /** Free-tier limits from the model catalog; undefined means unlimited. */
  limits?: RateLimits;
  now?: () => number;
}

/**
 * Token-bucket rate limiter (spec §7 wrapper 2). An empty bucket throws rate_limited at once;
 * the "one moment… then hand off" behavior belongs to the agent loop.
 */
export function withRateLimit(inner: LLMProvider, options: RateLimitOptions): LLMProvider {
  const { store, limits, now = Date.now } = options;

  async function acquire(): Promise<void> {
    if (!limits) return;
    const nowMs = now();
    const result = await store.take(inner.model, {
      limits,
      nowMs,
      day: pacificDay(nowMs),
      dayEndsInMs: msUntilPacificMidnight(nowMs),
    });
    if (!result.ok) {
      throw new LLMError("rate_limited", `Rate limit reached for ${inner.model}`, {
        retryAfterMs: result.retryAfterMs,
      });
    }
  }

  return {
    model: inner.model,
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      await acquire();
      yield* inner.stream(req);
    },
    async generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }> {
      await acquire();
      return inner.generate(req, schema);
    },
  };
}
