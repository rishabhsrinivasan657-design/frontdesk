import {
  LLMError,
  type LLMChunk,
  type LLMProvider,
  type LLMRequest,
  type Usage,
} from "@frontdesk/core";
import type { ZodType } from "zod";

export interface RetryOptions {
  /** Retries after the first attempt (spec §7: at most 2). */
  maxRetries?: number;
  baseMs?: number;
  /** Total time, from the first attempt, that waiting may reach (the latency budget). */
  budgetMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retry with exponential backoff on 429/5xx (spec §7 wrapper 3). A stream is retried only if it
 * failed before yielding anything: output the caller already received cannot be taken back.
 */
export function withRetry(inner: LLMProvider, options: RetryOptions = {}): LLMProvider {
  const {
    maxRetries = 2,
    baseMs = 250,
    budgetMs = 4000,
    sleep = realSleep,
    now = Date.now,
    random = Math.random,
  } = options;

  /** Waits before the next attempt, or rethrows when the error is final. */
  async function backoff(error: unknown, retry: number, startedAt: number): Promise<void> {
    if (!(error instanceof LLMError) || !error.retryable || retry >= maxRetries) throw error;
    const delay = error.retryAfterMs ?? baseMs * 2 ** retry * (0.5 + random() * 0.5);
    if (now() + delay - startedAt > budgetMs) throw error;
    await sleep(delay);
  }

  return {
    model: inner.model,
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const startedAt = now();
      for (let retry = 0; ; retry++) {
        let yielded = false;
        try {
          for await (const chunk of inner.stream(req)) {
            yielded = true;
            yield chunk;
          }
          return;
        } catch (error) {
          if (yielded) throw error;
          await backoff(error, retry, startedAt);
        }
      }
    },
    async generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }> {
      const startedAt = now();
      for (let retry = 0; ; retry++) {
        try {
          return await inner.generate(req, schema);
        } catch (error) {
          await backoff(error, retry, startedAt);
        }
      }
    },
  };
}
