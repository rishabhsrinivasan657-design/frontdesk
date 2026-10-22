import { LLMError, type LLMChunk } from "@frontdesk/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeProvider, type FakeStep } from "../providers/fake.js";
import { collect, testRequest } from "../test-request.js";
import { withRetry } from "./retry.js";

const Answer = z.object({ answer: z.string() });
const http = (status: number, retryAfterMs?: number) =>
  new LLMError(status === 429 ? "rate_limited" : "upstream", `HTTP ${status}`, {
    status,
    retryAfterMs,
  });

function setup(script: FakeStep[], options: { budgetMs?: number } = {}) {
  let clock = 0;
  const waits: number[] = [];
  const inner = new FakeProvider(script);
  const llm = withRetry(inner, {
    ...options,
    now: () => clock,
    sleep: (ms) => {
      waits.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    random: () => 0.5,
  });
  return { inner, llm, waits };
}

describe("withRetry", () => {
  it("retries 503 twice then succeeds on the third attempt", async () => {
    const { llm, inner, waits } = setup([
      { error: http(503) },
      { error: http(503) },
      { generate: { answer: "ok" } },
    ]);
    expect((await llm.generate(testRequest(), Answer)).value).toEqual({ answer: "ok" });
    expect(inner.calls).toHaveLength(3);
    expect(waits).toEqual([187.5, 375]);
  });

  it("gives up after 2 retries and rethrows the last error", async () => {
    const last = http(500);
    const { llm, inner } = setup([{ error: http(503) }, { error: http(502) }, { error: last }]);
    await expect(llm.generate(testRequest(), Answer)).rejects.toBe(last);
    expect(inner.calls).toHaveLength(3);
  });

  it.each([
    ["400", http(400)],
    ["invalid_output", new LLMError("invalid_output", "bad json")],
    ["spend_cap", new LLMError("spend_cap", "cap")],
  ])("does not retry %s", async (_name, error) => {
    const { llm, inner } = setup([{ error }]);
    await expect(llm.generate(testRequest(), Answer)).rejects.toBe(error);
    expect(inner.calls).toHaveLength(1);
  });

  it("does not retry a non-LLMError", async () => {
    const { llm, inner } = setup([{ error: new RangeError("bug") as unknown as LLMError }]);
    await expect(llm.generate(testRequest(), Answer)).rejects.toThrow("bug");
    expect(inner.calls).toHaveLength(1);
  });

  it("honors retryAfterMs from a 429", async () => {
    const { llm, waits } = setup([{ error: http(429, 1200) }, { generate: { answer: "ok" } }]);
    await llm.generate(testRequest(), Answer);
    expect(waits).toEqual([1200]);
  });

  it("stops when the next wait would exceed budgetMs", async () => {
    const error = http(429, 34_000);
    const { llm, inner, waits } = setup([{ error }, { generate: { answer: "ok" } }]);
    await expect(llm.generate(testRequest(), Answer)).rejects.toBe(error);
    expect(inner.calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it("budget counts time already spent", async () => {
    const { llm, inner } = setup(
      [{ error: http(503) }, { error: http(503) }, { generate: { answer: "ok" } }],
      {
        budgetMs: 300,
      },
    );
    // first wait 187.5 fits; second wait 375 would end at 562.5 > 300
    await expect(llm.generate(testRequest(), Answer)).rejects.toMatchObject({ status: 503 });
    expect(inner.calls).toHaveLength(2);
  });

  it("stream failing before any chunk is retried", async () => {
    const chunks: LLMChunk[] = [{ type: "text", text: "Hello" }];
    const { llm, inner } = setup([{ error: http(503) }, { stream: chunks }]);
    expect(await collect(llm.stream(testRequest()))).toEqual(chunks);
    expect(inner.calls).toHaveLength(2);
  });

  it("stream failing after a text chunk rethrows without retrying", async () => {
    const error = http(503);
    const { llm, inner } = setup([
      { error, afterChunks: [{ type: "text", text: "Hel" }] },
      { stream: [{ type: "text", text: "Hello" }] },
    ]);
    const seen: LLMChunk[] = [];
    await expect(async () => {
      for await (const c of llm.stream(testRequest())) seen.push(c);
    }).rejects.toBe(error);
    expect(seen).toEqual([{ type: "text", text: "Hel" }]);
    expect(inner.calls).toHaveLength(1);
  });
});
