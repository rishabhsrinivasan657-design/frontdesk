import { LLMError, type LLMChunk, type LLMProvider } from "@frontdesk/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { collect, testRequest } from "../test-request.js";
import { withHedge } from "./hedge.js";

const Answer = z.object({ answer: z.string() });
const text = (t: string): LLMChunk => ({ type: "text", text: t });
const busy = () => new LLMError("upstream", "HTTP 503", { status: 503 });

/** A provider that answers (or fails) only when the test opens its gate. */
function gated(model: string) {
  let open!: () => void;
  let fail!: (error: unknown) => void;
  const gate = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  gate.catch(() => undefined);
  const state = { calls: 0, closed: false };
  const provider: LLMProvider = {
    model,
    async *stream() {
      state.calls += 1;
      try {
        await gate;
        yield text(`${model} 1`);
        yield text(`${model} 2`);
      } finally {
        state.closed = true;
      }
    },
    async generate<T>() {
      state.calls += 1;
      await gate;
      return { value: { answer: model } as T, usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
  return { provider, open: () => open(), fail: (e: unknown) => fail(e), state };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("withHedge", () => {
  it("races both models at once and streams the first to answer", async () => {
    const a = gated("a");
    const b = gated("b");
    const done = collect(withHedge(a.provider, b.provider).stream(testRequest()));
    await tick();
    expect([a.state.calls, b.state.calls]).toEqual([1, 1]);
    b.open();
    expect(await done).toEqual([text("b 1"), text("b 2")]);
    a.open();
    await tick();
    expect(a.state.closed).toBe(true); // the loser is closed at its first chunk
  });

  it("keeps the backup idle while the primary answers within afterMs", async () => {
    const a = gated("a");
    const b = gated("b");
    a.open();
    const llm = withHedge(a.provider, b.provider, { afterMs: 1000 });
    expect(await collect(llm.stream(testRequest()))).toEqual([text("a 1"), text("a 2")]);
    expect(b.state.calls).toBe(0);
  });

  it("starts the backup once the primary is slower than afterMs", async () => {
    const a = gated("a");
    const b = gated("b");
    b.open();
    const llm = withHedge(a.provider, b.provider, { afterMs: 5 });
    expect(await collect(llm.stream(testRequest()))).toEqual([text("b 1"), text("b 2")]);
    expect(a.state.calls).toBe(1);
  });

  it("starts the backup at once when the primary fails early", async () => {
    const a = gated("a");
    const b = gated("b");
    b.open();
    a.fail(busy());
    const llm = withHedge(a.provider, b.provider, { afterMs: 60_000 });
    expect(await collect(llm.stream(testRequest()))).toEqual([text("b 1"), text("b 2")]);
  });

  it("waits for the other model when one fails, and throws the primary's error if both do", async () => {
    const a = gated("a");
    const b = gated("b");
    const primaryError = busy();
    const done = collect(withHedge(a.provider, b.provider).stream(testRequest()));
    b.fail(new LLMError("rate_limited", "bucket empty"));
    await tick();
    a.fail(primaryError);
    await expect(done).rejects.toBe(primaryError);
  });

  it("does not switch models once a chunk was streamed", async () => {
    const error = busy();
    const a: LLMProvider = {
      model: "a",
      async *stream() {
        await tick();
        yield text("a 1");
        throw error;
      },
      generate: () => Promise.reject(new Error("unused")),
    };
    const b = gated("b");
    const llm = withHedge(a, b.provider);
    const seen: LLMChunk[] = [];
    await expect(
      (async () => {
        for await (const chunk of llm.stream(testRequest())) seen.push(chunk);
      })(),
    ).rejects.toBe(error);
    expect(seen).toEqual([text("a 1")]);
  });

  it("hedges generate the same way and reports the primary's model", async () => {
    const a = gated("a");
    const b = gated("b");
    const llm = withHedge(a.provider, b.provider);
    expect(llm.model).toBe("a");
    const done = llm.generate(testRequest(), Answer);
    b.open();
    expect((await done).value).toEqual({ answer: "b" });
  });
});
