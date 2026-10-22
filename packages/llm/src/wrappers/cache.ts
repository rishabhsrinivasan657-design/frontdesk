import type { LLMChunk, LLMProvider, LLMRequest, Usage } from "@frontdesk/core";
import type { ZodType } from "zod";
import { parseOutput } from "../output.js";
import { requestKey } from "../recordings.js";
import type { CacheStore } from "../stores/types.js";

export interface CacheOptions {
  store: CacheStore;
  ttlSec?: number;
}

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

/** Confirmation classifier calls must always reach the model (spec §7). */
const bypasses = (req: LLMRequest) => req.purpose === "confirmation";

/** True if any call names a write tool; an unknown tool name counts as a write (fail safe). */
function hasWriteCall(req: LLMRequest, chunks: LLMChunk[]): boolean {
  const effects = new Map((req.tools ?? []).map((t) => [t.name, t.effect]));
  return chunks.some((c) => c.type === "tool_call" && effects.get(c.call.name) !== "read");
}

/**
 * Response cache (spec §7 wrapper 4), keyed by model, prompt and tool results. Never serves the
 * confirmation classifier, and never stores a turn that produced a write tool call.
 * A hit reports zero usage so spend is not counted twice.
 */
export function withCache(inner: LLMProvider, options: CacheOptions): LLMProvider {
  const { store, ttlSec = 86_400 } = options;
  const keyFor = (...args: Parameters<typeof requestKey>) => `llm:cache:${requestKey(...args)}`;

  return {
    model: inner.model,
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      if (bypasses(req)) {
        yield* inner.stream(req);
        return;
      }
      const key = keyFor("stream", inner.model, req);
      const hit = await store.get(key);
      if (hit !== undefined) {
        yield* (JSON.parse(hit) as { chunks: LLMChunk[] }).chunks;
        yield { type: "usage", usage: ZERO_USAGE };
        return;
      }
      const chunks: LLMChunk[] = [];
      for await (const chunk of inner.stream(req)) {
        if (chunk.type !== "usage") chunks.push(chunk);
        yield chunk;
      }
      // Decided only once the stream completed: a write call may arrive in the last chunk.
      if (!hasWriteCall(req, chunks)) await store.set(key, JSON.stringify({ chunks }), ttlSec);
    },
    async generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }> {
      if (bypasses(req)) return inner.generate(req, schema);
      const key = keyFor("generate", inner.model, req, schema);
      const hit = await store.get(key);
      if (hit !== undefined) {
        const { value } = JSON.parse(hit) as { value: unknown };
        return { value: parseOutput(schema, value), usage: ZERO_USAGE };
      }
      const result = await inner.generate(req, schema);
      await store.set(key, JSON.stringify({ value: result.value }), ttlSec);
      return result;
    },
  };
}
