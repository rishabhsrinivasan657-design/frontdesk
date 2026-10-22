import type { LLMChunk, LLMProvider, LLMRequest, Usage } from "@frontdesk/core";
import type { ZodType } from "zod";
import {
  type CallMode,
  type Recording,
  type RecordingStore,
  requestKey,
  templateHash,
} from "../recordings.js";

export interface RecorderOptions {
  store: RecordingStore;
  now?: () => number;
}

/** Record mode (spec §7 wrapper 5): stores each completed call for the replay provider. */
export function withRecorder(inner: LLMProvider, options: RecorderOptions): LLMProvider {
  const { store, now = Date.now } = options;

  const save = (
    mode: CallMode,
    req: LLMRequest,
    response: Recording["response"],
    schema?: ZodType,
  ): Promise<void> =>
    store.put({
      version: 1,
      key: requestKey(mode, inner.model, req, schema),
      templateId: req.template.id,
      templateHash: templateHash(req),
      model: inner.model,
      mode,
      request: req,
      response,
      recordedAt: new Date(now()).toISOString(),
    });

  return {
    model: inner.model,
    async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
      const chunks: LLMChunk[] = [];
      for await (const chunk of inner.stream(req)) {
        chunks.push(chunk);
        yield chunk;
      }
      await save("stream", req, { chunks });
    },
    async generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }> {
      const result = await inner.generate(req, schema);
      await save("generate", req, { value: result.value, usage: result.usage }, schema);
      return result;
    },
  };
}
