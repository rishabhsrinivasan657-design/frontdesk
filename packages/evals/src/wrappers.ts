import {
  LLMError,
  TURN_TEMPLATE,
  parseMeta,
  type LLMChunk,
  type LLMProvider,
  type LLMRequest,
  type Usage,
} from "@frontdesk/core";
import type { ZodType } from "zod";

/** Passes every call through, noting each LLMError (the agent loop swallows them). */
export function withErrorTap(inner: LLMProvider, sink: LLMError[]): LLMProvider {
  const note = (error: unknown): never => {
    if (error instanceof LLMError) sink.push(error);
    throw error;
  };
  return {
    model: inner.model,
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      try {
        yield* inner.stream(req);
      } catch (error) {
        note(error);
      }
    },
    generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }> {
      return inner.generate(req, schema).catch(note);
    },
  };
}

/** Notes the `@meta` confidence of every agent-turn draft, for the threshold sweep. */
export function withMetaTap(inner: LLMProvider, sink: number[]): LLMProvider {
  return {
    model: inner.model,
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      let draft = "";
      for await (const chunk of inner.stream(req)) {
        if (chunk.type === "text") draft += chunk.text;
        yield chunk;
      }
      if (req.template.id !== TURN_TEMPLATE.id || draft === "") return;
      const meta = parseMeta(draft);
      if (!meta.missing) sink.push(meta.confidence);
    },
    generate: (req, schema) => inner.generate(req, schema),
  };
}

export interface PatienceOptions {
  /** Real-time sleep; the agent's ManualClock must not be used here. */
  sleep: (ms: number) => Promise<void>;
  maxWaitMs?: number;
  maxTries?: number;
  /** Wait used when the error carries no retry time (a 429 straight from Gemini). */
  defaultWaitMs?: number;
}

/**
 * Record/live runs only: waits out a per-minute rate limit instead of letting the agent
 * hand off, so a recording never captures a fake `rate_limited` handoff. A wait longer than
 * `maxWaitMs` (the daily quota) is rethrown.
 */
export function withPatience(inner: LLMProvider, options: PatienceOptions): LLMProvider {
  const { sleep, maxWaitMs = 65_000, maxTries = 3, defaultWaitMs = 20_000 } = options;
  const waitFor = (error: unknown, attempt: number): number | undefined =>
    error instanceof LLMError &&
    error.code === "rate_limited" &&
    attempt < maxTries &&
    (error.retryAfterMs ?? defaultWaitMs) <= maxWaitMs
      ? (error.retryAfterMs ?? defaultWaitMs)
      : undefined;

  return {
    model: inner.model,
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      for (let attempt = 1; ; attempt++) {
        let yielded = false;
        try {
          for await (const chunk of inner.stream(req)) {
            yielded = true;
            yield chunk;
          }
          return;
        } catch (error) {
          const wait = yielded ? undefined : waitFor(error, attempt);
          if (wait === undefined) throw error;
          await sleep(wait);
        }
      }
    },
    async generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }> {
      for (let attempt = 1; ; attempt++) {
        try {
          return await inner.generate(req, schema);
        } catch (error) {
          const wait = waitFor(error, attempt);
          if (wait === undefined) throw error;
          await sleep(wait);
        }
      }
    },
  };
}
