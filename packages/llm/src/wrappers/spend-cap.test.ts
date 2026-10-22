import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeProvider, type FakeStep } from "../providers/fake.js";
import { MemorySpendStore } from "../stores/memory.js";
import { collect, testRequest } from "../test-request.js";
import { projectCostUsd, withSpendCap } from "./spend-cap.js";

const price = { input: 0.3, output: 2.5 };
const now = () => Date.parse("2026-10-22T18:00:00Z");
const Answer = z.object({ answer: z.string() });
const MONTH = "2026-10";
// 1M input + 1M output tokens: $0.30 + $2.50.
const bigUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

function setup(tier: "free" | "paid", capUsd: number, script: FakeStep[]) {
  const inner = new FakeProvider(script);
  const store = new MemorySpendStore();
  return { inner, store, llm: withSpendCap(inner, { store, tier, capUsd, price, now }) };
}

describe("projectCostUsd", () => {
  it("uses chars/4 and the request's maxOutputTokens", () => {
    // 396 system chars + "[]" messages + "[]" tools = 400 chars = 100 tokens.
    const req = testRequest({ system: "x".repeat(396), messages: [], maxOutputTokens: 1000 });
    expect(projectCostUsd(req, price)).toBeCloseTo(0.00253, 12);
  });

  it("defaults maxOutputTokens to 1024", () => {
    const req = testRequest({ system: "x".repeat(396), messages: [] });
    expect(projectCostUsd(req, price)).toBeCloseTo(0.00259, 12);
  });
});

describe("withSpendCap", () => {
  it("free tier never blocks and records shadowUsd with usd 0", async () => {
    const { llm, store } = setup("free", 0, [{ generate: { answer: "a" }, usage: bigUsage }]);
    await llm.generate(testRequest(), Answer);
    const totals = await store.get(MONTH);
    expect(totals).toMatchObject({ usd: 0, inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(totals.shadowUsd).toBeCloseTo(2.8, 10);
  });

  it("paid call under the cap passes and records usd", async () => {
    const { llm, store } = setup("paid", 5, [{ generate: { answer: "a" }, usage: bigUsage }]);
    await llm.generate(testRequest(), Answer);
    const totals = await store.get(MONTH);
    expect(totals.usd).toBeCloseTo(2.8, 10);
    expect(totals.shadowUsd).toBeCloseTo(2.8, 10);
  });

  it("paid call whose projection exceeds the cap is refused without calling inner", async () => {
    const { llm, inner } = setup("paid", 0.001, [{ generate: { answer: "a" } }]);
    await expect(llm.generate(testRequest(), Answer)).rejects.toMatchObject({
      code: "spend_cap",
      retryable: false,
    });
    expect(inner.calls).toHaveLength(0);
  });

  it("paid at cap 0 refuses every call (fail closed)", async () => {
    const { llm, inner } = setup("paid", 0, [{ stream: [] }]);
    await expect(collect(llm.stream(testRequest()))).rejects.toMatchObject({ code: "spend_cap" });
    expect(inner.calls).toHaveLength(0);
  });

  it("after one call overshoots, the next is refused", async () => {
    const { llm, inner } = setup("paid", 3, [
      { generate: { answer: "a" }, usage: { inputTokens: 1_000_000, outputTokens: 1_200_000 } }, // $3.30
      { generate: { answer: "b" } },
    ]);
    await llm.generate(testRequest(), Answer);
    await expect(llm.generate(testRequest(), Answer)).rejects.toMatchObject({ code: "spend_cap" });
    expect(inner.calls).toHaveLength(1);
  });

  it("stream usage is recorded", async () => {
    const { llm, store } = setup("paid", 5, [
      {
        stream: [
          { type: "text", text: "hi" },
          { type: "usage", usage: bigUsage },
        ],
      },
    ]);
    expect(await collect(llm.stream(testRequest()))).toHaveLength(2);
    expect((await store.get(MONTH)).usd).toBeCloseTo(2.8, 10);
  });

  it("a stream abandoned before its usage chunk records the projected cost", async () => {
    const { llm, store } = setup("paid", 5, [
      {
        stream: [
          { type: "text", text: "hi" },
          { type: "usage", usage: bigUsage },
        ],
      },
    ]);
    const req = testRequest({ system: "x".repeat(396), messages: [], maxOutputTokens: 1000 });
    for await (const chunk of llm.stream(req)) {
      if (chunk.type === "text") break;
    }
    expect((await store.get(MONTH)).usd).toBeCloseTo(0.00253, 12);
  });
});
