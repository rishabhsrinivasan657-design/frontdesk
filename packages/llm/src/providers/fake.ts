import type { LLMChunk, LLMError, LLMProvider, LLMRequest, Usage } from "@frontdesk/core";
import type { ZodType } from "zod";
import { parseOutput } from "../output.js";

export type FakeStep =
  | { stream: LLMChunk[] }
  | { generate: unknown; usage?: Usage }
  | { error: LLMError; afterChunks?: LLMChunk[] };

const DEFAULT_USAGE: Usage = { inputTokens: 10, outputTokens: 5 };

/** Scripted provider for unit tests: each call consumes the next step. */
export class FakeProvider implements LLMProvider {
  readonly calls: { mode: "stream" | "generate"; req: LLMRequest }[] = [];
  private next = 0;

  constructor(
    private readonly script: FakeStep[],
    readonly model = "fake",
  ) {}

  async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    const step = this.take("stream", req);
    if ("generate" in step) throw this.mismatch("stream", "generate");
    if ("error" in step) {
      yield* step.afterChunks ?? [];
      throw step.error;
    }
    yield* step.stream;
  }

  generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }> {
    return Promise.resolve().then(() => {
      const step = this.take("generate", req);
      if ("stream" in step) throw this.mismatch("generate", "stream");
      if ("error" in step) throw step.error;
      return { value: parseOutput(schema, step.generate), usage: step.usage ?? DEFAULT_USAGE };
    });
  }

  private take(mode: "stream" | "generate", req: LLMRequest): FakeStep {
    const step = this.script[this.next];
    if (step === undefined) {
      throw new Error(`FakeProvider: script exhausted at step ${this.next} (${mode} call)`);
    }
    this.calls.push({ mode, req });
    this.next += 1;
    return step;
  }

  private mismatch(called: string, scripted: string): Error {
    return new Error(
      `FakeProvider: ${called} called but step ${this.next - 1} is a ${scripted} step`,
    );
  }
}
