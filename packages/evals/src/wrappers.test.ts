import { LLMError } from "@frontdesk/core";
import { FakeProvider } from "@frontdesk/llm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { text } from "./testing.js";
import { withErrorTap, withPatience } from "./wrappers.js";

const REQ = {
  purpose: "turn" as const,
  template: { id: "t", text: "t" },
  system: "s",
  messages: [],
};
const limited = (ms: number) => new LLMError("rate_limited", "slow down", { retryAfterMs: ms });
const drain = async (it: AsyncIterable<unknown>) => {
  const out = [];
  for await (const c of it) out.push(c);
  return out;
};

describe("withErrorTap", () => {
  it("records LLMError codes and rethrows", async () => {
    const sink: LLMError[] = [];
    const llm = withErrorTap(new FakeProvider([{ error: new LLMError("replay_miss", "x") }]), sink);
    await expect(drain(llm.stream(REQ))).rejects.toThrow("x");
    expect(sink.map((e) => e.code)).toEqual(["replay_miss"]);
  });
});

describe("withPatience", () => {
  it("waits and retries a per-minute limit", async () => {
    const slept: number[] = [];
    const inner = new FakeProvider([{ error: limited(6000) }, { generate: { ok: true } }]);
    const llm = withPatience(inner, { sleep: (ms) => (slept.push(ms), Promise.resolve()) });
    expect((await llm.generate(REQ, z.object({ ok: z.boolean() }))).value).toEqual({ ok: true });
    expect(slept).toEqual([6000]);
  });

  it("retries a stream that failed before yielding", async () => {
    const inner = new FakeProvider([{ error: limited(10) }, { stream: [text("hi")] }]);
    const llm = withPatience(inner, { sleep: () => Promise.resolve() });
    expect(await drain(llm.stream(REQ))).toEqual([text("hi")]);
  });

  it("rethrows when the wait exceeds maxWaitMs", async () => {
    const inner = new FakeProvider([{ error: limited(3_600_000) }]);
    const llm = withPatience(inner, { sleep: () => Promise.resolve() });
    await expect(llm.generate(REQ, z.object({}))).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("gives up after maxTries", async () => {
    const inner = new FakeProvider([
      { error: limited(1) },
      { error: limited(1) },
      { error: limited(1) },
    ]);
    const llm = withPatience(inner, { sleep: () => Promise.resolve(), maxTries: 3 });
    await expect(llm.generate(REQ, z.object({}))).rejects.toMatchObject({ code: "rate_limited" });
    expect(inner.calls).toHaveLength(3);
  });

  it("does not retry a stream that already yielded", async () => {
    const inner = new FakeProvider([{ error: limited(1), afterChunks: [text("par")] }]);
    const llm = withPatience(inner, { sleep: () => Promise.resolve() });
    await expect(drain(llm.stream(REQ))).rejects.toMatchObject({ code: "rate_limited" });
    expect(inner.calls).toHaveLength(1);
  });
});
