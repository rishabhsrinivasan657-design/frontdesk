import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LLMError } from "../llm/errors.js";
import type { LLMChunk, LLMRequest } from "../llm/types.js";
import { TestLLM } from "./test-llm.js";

const req: LLMRequest = {
  purpose: "turn",
  template: { id: "t", text: "t" },
  system: "s",
  messages: [{ role: "user", text: "hi" }],
};

async function collect(stream: AsyncIterable<LLMChunk>): Promise<LLMChunk[]> {
  const out: LLMChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

describe("TestLLM", () => {
  it("yields the stream handler's chunks in order, then usage, and logs the call", async () => {
    const llm = new TestLLM();
    llm.onStream(() => [
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]);
    expect(await collect(llm.stream(req))).toEqual([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
      { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
    ]);
    expect(llm.calls).toEqual([{ mode: "stream", req }]);
  });

  it("generate validates the handler's value with the schema", async () => {
    const llm = new TestLLM();
    llm.onGenerate(() => ({ decision: "confirm" }));
    const ok = await llm.generate(req, z.object({ decision: z.string() }));
    expect(ok.value).toEqual({ decision: "confirm" });
    await expect(llm.generate(req, z.object({ decision: z.number() }))).rejects.toMatchObject({
      code: "invalid_output",
    });
  });

  it("failWith makes every call throw that error", async () => {
    const llm = new TestLLM();
    llm.failWith(new LLMError("upstream", "boom", { status: 503 }));
    await expect(collect(llm.stream(req))).rejects.toMatchObject({ code: "upstream" });
    await expect(llm.generate(req, z.object({}))).rejects.toMatchObject({ code: "upstream" });
  });
});
