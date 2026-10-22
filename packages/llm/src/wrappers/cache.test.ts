import type { LLMChunk, LLMRequest, ToolSpec } from "@frontdesk/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeProvider, type FakeStep } from "../providers/fake.js";
import { requestKey } from "../recordings.js";
import { MemoryCacheStore } from "../stores/memory.js";
import { collect, testRequest } from "../test-request.js";
import { withCache } from "./cache.js";

const tool = (name: string, effect: "read" | "write"): ToolSpec => ({
  name,
  description: name,
  parameters: { type: "object" },
  effect,
});
const tools = [tool("check_availability", "read"), tool("book", "write")];
const usage = { type: "usage", usage: { inputTokens: 7, outputTokens: 3 } } as const;
const ZERO = { type: "usage", usage: { inputTokens: 0, outputTokens: 0 } } as const;
const call = (name: string): LLMChunk => ({
  type: "tool_call",
  call: { id: "c1", name, args: {} },
});
const Answer = z.object({ answer: z.string() });

function setup(script: FakeStep[]) {
  const inner = new FakeProvider(script);
  const store = new MemoryCacheStore();
  return { inner, store, llm: withCache(inner, { store }) };
}

describe("withCache", () => {
  it("second identical stream is served from cache without calling inner", async () => {
    const chunks: LLMChunk[] = [{ type: "text", text: "We open at 5." }, usage];
    const { llm, inner } = setup([{ stream: chunks }]);
    expect(await collect(llm.stream(testRequest()))).toEqual(chunks);
    expect(await collect(llm.stream(testRequest()))).toEqual([
      { type: "text", text: "We open at 5." },
      ZERO,
    ]);
    expect(inner.calls).toHaveLength(1);
  });

  it("generate is cached and re-validated through the schema", async () => {
    const { llm, inner } = setup([{ generate: { answer: "yes" } }]);
    await llm.generate(testRequest(), Answer);
    const hit = await llm.generate(testRequest(), Answer);
    expect(hit).toEqual({ value: { answer: "yes" }, usage: { inputTokens: 0, outputTokens: 0 } });
    expect(inner.calls).toHaveLength(1);
    await expect(llm.generate(testRequest(), z.object({ answer: z.number() }))).rejects.toThrow(
      /FakeProvider/,
    );
  });

  it("different tool result → miss", async () => {
    const { llm, inner } = setup([{ stream: [usage] }, { stream: [usage] }]);
    const withResult = (result: string): LLMRequest =>
      testRequest({
        messages: [{ role: "tool", callId: "c", name: "check_availability", result }],
      });
    await collect(llm.stream(withResult("19:00 free")));
    await collect(llm.stream(withResult("19:00 taken")));
    expect(inner.calls).toHaveLength(2);
  });

  it("confirmation purpose is never read or written", async () => {
    const req = testRequest({ purpose: "confirmation" });
    const { llm, inner, store } = setup([
      { generate: { answer: "fresh" } },
      { generate: { answer: "fresh2" } },
    ]);
    await store.set(
      `llm:cache:${requestKey("generate", "fake", req, Answer)}`,
      JSON.stringify({ value: { answer: "stale" } }),
      60,
    );
    expect((await llm.generate(req, Answer)).value).toEqual({ answer: "fresh" });
    expect((await llm.generate(req, Answer)).value).toEqual({ answer: "fresh2" });
    expect(inner.calls).toHaveLength(2);
  });

  it("turn producing a write tool call is not stored", async () => {
    const req = testRequest({ tools });
    const { llm, inner } = setup([
      { stream: [call("book"), usage] },
      { stream: [call("book"), usage] },
    ]);
    await collect(llm.stream(req));
    await collect(llm.stream(req));
    expect(inner.calls).toHaveLength(2);
  });

  it("write tool call in the last chunk is not stored", async () => {
    const req = testRequest({ tools });
    const chunks: LLMChunk[] = [{ type: "text", text: "Booking that now." }, usage, call("book")];
    const { llm, inner } = setup([{ stream: chunks }, { stream: chunks }]);
    expect(await collect(llm.stream(req))).toEqual(chunks);
    await collect(llm.stream(req));
    expect(inner.calls).toHaveLength(2);
  });

  it("unknown tool name is treated as write", async () => {
    const req = testRequest({ tools });
    const { llm, inner } = setup([{ stream: [call("mystery")] }, { stream: [call("mystery")] }]);
    await collect(llm.stream(req));
    await collect(llm.stream(req));
    expect(inner.calls).toHaveLength(2);
  });

  it("read-only tool call turn is stored", async () => {
    const req = testRequest({ tools });
    const { llm, inner } = setup([{ stream: [call("check_availability"), usage] }]);
    await collect(llm.stream(req));
    expect(await collect(llm.stream(req))).toEqual([call("check_availability"), ZERO]);
    expect(inner.calls).toHaveLength(1);
  });

  it("an abandoned or failed stream is not stored", async () => {
    const chunks: LLMChunk[] = [{ type: "text", text: "a" }, { type: "text", text: "b" }, usage];
    const { llm, inner } = setup([{ stream: chunks }, { stream: chunks }]);
    for await (const chunk of llm.stream(testRequest())) {
      if (chunk.type === "text") break;
    }
    await collect(llm.stream(testRequest()));
    expect(inner.calls).toHaveLength(2);
  });
});
