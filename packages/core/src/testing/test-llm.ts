import type { ZodType } from "zod";
import { LLMError } from "../llm/errors.js";
import type { LLMChunk, LLMProvider, LLMRequest, Usage } from "../llm/types.js";

const USAGE: Usage = { inputTokens: 10, outputTokens: 5 };

/**
 * Programmable provider for core tests. Handlers are mutable so a test can change behavior
 * between turns. Core can't use @frontdesk/llm's FakeProvider: llm depends on core.
 */
export class TestLLM implements LLMProvider {
  readonly model = "test";
  readonly calls: { mode: "stream" | "generate"; req: LLMRequest }[] = [];
  private streamFn: (req: LLMRequest) => LLMChunk[] = () => {
    throw new Error("TestLLM: no stream handler set");
  };
  private generateFn: (req: LLMRequest) => unknown = () => {
    throw new Error("TestLLM: no generate handler set");
  };
  private error: Error | undefined;

  onStream(fn: (req: LLMRequest) => LLMChunk[]): this {
    this.streamFn = fn;
    return this;
  }

  onGenerate(fn: (req: LLMRequest) => unknown): this {
    this.generateFn = fn;
    return this;
  }

  /** Every later call throws `error`; pass undefined to clear. */
  failWith(error: Error | undefined): this {
    this.error = error;
    return this;
  }

  // Handlers are synchronous; the generator stays async to match the interface.
  // eslint-disable-next-line @typescript-eslint/require-await
  async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    this.calls.push({ mode: "stream", req });
    if (this.error) throw this.error;
    yield* this.streamFn(req);
    yield { type: "usage", usage: USAGE };
  }

  generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }> {
    return Promise.resolve().then(() => {
      this.calls.push({ mode: "generate", req });
      if (this.error) throw this.error;
      const parsed = schema.safeParse(this.generateFn(req));
      if (!parsed.success) {
        throw new LLMError(
          "invalid_output",
          `TestLLM output failed schema: ${parsed.error.message}`,
        );
      }
      return { value: parsed.data, usage: USAGE };
    });
  }
}
