import { ApiError, type GenerateContentResponse } from "@google/genai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LLMConfigError } from "./catalog.js";
import { type CreateLLMDeps, createLLM } from "./create.js";
import type { GeminiModels } from "./providers/gemini.js";
import { MemoryRecordingStore } from "./recordings.js";
import { MemoryCacheStore, MemoryRateLimitStore, MemorySpendStore } from "./stores/memory.js";
import type { RateLimitStore } from "./stores/types.js";
import { collect, testRequest } from "./test-request.js";

const ok = {
  candidates: [{ content: { role: "model", parts: [{ text: '{"answer":"yes"}' }] } }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
} as GenerateContentResponse;
const Answer = z.object({ answer: z.string() });

/** Gemini client that fails with the given errors first, then answers; `models` logs each call. */
function client(failures: Error[] = [], models: string[] = []): GeminiModels {
  const next = ({ model }: { model: string }) => {
    models.push(model);
    const error = failures.shift();
    return error ? Promise.reject(error) : Promise.resolve(ok);
  };
  return {
    generateContent: next,
    generateContentStream: (params) =>
      next(params).then((r) =>
        (async function* () {
          await Promise.resolve();
          yield r;
        })(),
      ),
  };
}

function deps(overrides: Partial<CreateLLMDeps> = {}) {
  let takes = 0;
  const inner = new MemoryRateLimitStore();
  const rate: RateLimitStore = {
    take: (model, options) => {
      takes += 1;
      return inner.take(model, options);
    },
  };
  const d: CreateLLMDeps = {
    rate,
    spend: new MemorySpendStore(),
    cache: new MemoryCacheStore(),
    recordings: new MemoryRecordingStore(),
    geminiClient: client(),
    retry: { sleep: () => Promise.resolve() },
    ...overrides,
  };
  return { d, takes: () => takes };
}

describe("createLLM", () => {
  it("defaults to gemini-3.5-flash-lite on the free tier", async () => {
    const { d } = deps();
    const llm = createLLM({}, d);
    expect(llm.model).toBe("gemini-3.5-flash-lite");
    await llm.generate(testRequest(), Answer);
    expect((await d.spend.get(new Date().toISOString().slice(0, 7))).usd).toBe(0);
  });

  it("wrappers apply in spec order", async () => {
    const { d, takes } = deps({
      geminiClient: client([new ApiError({ message: "busy", status: 503 })]),
    });
    const llm = createLLM({ LLM_PROVIDER: "gemini", LLM_HEDGE_MODEL: "none" }, d);
    expect((await llm.generate(testRequest(), Answer)).value).toEqual({ answer: "yes" });
    expect(takes()).toBe(1); // retry runs inside the rate limiter
    const month = new Date().toISOString().slice(0, 7);
    expect(await d.spend.get(month)).toMatchObject({ inputTokens: 10, outputTokens: 2 }); // one entry
    await llm.generate(testRequest(), Answer); // cache hit: no new tokens recorded
    expect(await d.spend.get(month)).toMatchObject({ inputTokens: 10, outputTokens: 2 });
  });

  it("paid tier with cap 0 refuses to start", () => {
    expect(() => createLLM({ LLM_TIER: "paid" }, deps().d)).toThrow(LLMConfigError);
    expect(() => createLLM({ LLM_TIER: "paid", SPEND_CAP_USD_MONTHLY: "0" }, deps().d)).toThrow(
      /SPEND_CAP_USD_MONTHLY/,
    );
    expect(createLLM({ LLM_TIER: "paid", SPEND_CAP_USD_MONTHLY: "5" }, deps().d).model).toBe(
      "gemini-3.5-flash-lite",
    );
  });

  it.each([
    [{ LLM_PROVIDER: "openai" }, /LLM_PROVIDER.*gemini, replay/],
    [{ LLM_MODEL: "gpt-9" }, /LLM_MODEL.*gemini-3\.5-flash-lite/],
    [{ LLM_TIER: "gold" }, /LLM_TIER/],
    [{ SPEND_CAP_USD_MONTHLY: "-1" }, /SPEND_CAP_USD_MONTHLY/],
    [{ SPEND_CAP_USD_MONTHLY: "lots" }, /SPEND_CAP_USD_MONTHLY/],
    [{ LLM_TIMEOUT_MS: "0" }, /LLM_TIMEOUT_MS/],
    [{ LLM_TIMEOUT_MS: "soon" }, /LLM_TIMEOUT_MS/],
    [{ LLM_HEDGE_MODEL: "gpt-9" }, /LLM_HEDGE_MODEL.*"none"/],
    [{ LLM_HEDGE_AFTER_MS: "-1" }, /LLM_HEDGE_AFTER_MS/],
  ])("rejects invalid env %o", (env, message) => {
    expect(() => createLLM(env, deps().d)).toThrow(message);
  });

  it("missing key error names GEMINI_API_KEY", () => {
    expect(() => createLLM({}, deps({ geminiClient: undefined }).d)).toThrow(/GEMINI_API_KEY/);
  });

  it("LLM_RECORD=1 writes a recording", async () => {
    const { d } = deps();
    await collect(createLLM({ LLM_RECORD: "1" }, d).stream(testRequest()));
    expect((await d.recordings.hashesFor("test")).size).toBe(1);
  });

  it("replay provider has no wrappers", async () => {
    const { d, takes } = deps();
    await collect(createLLM({ LLM_RECORD: "1" }, d).stream(testRequest()));
    const replay = createLLM({ LLM_PROVIDER: "replay" }, d);
    expect((await collect(replay.stream(testRequest()))).length).toBeGreaterThan(0);
    expect(takes()).toBe(1); // only the recording run touched the rate limiter
  });

  it("record mode bypasses the cache so a warm cache cannot skip a recording", async () => {
    const { d } = deps();
    await collect(createLLM({}, d).stream(testRequest())); // warms the cache
    await collect(createLLM({ LLM_RECORD: "1" }, d).stream(testRequest()));
    expect((await d.recordings.hashesFor("test")).size).toBe(1);
  });

  describe("hedge", () => {
    async function modelsCalled(env: Record<string, string>) {
      const models: string[] = [];
      const { d, takes } = deps({ geminiClient: client([], models) });
      await createLLM(env, d).generate(testRequest(), Answer);
      return { models: models.sort(), takes: takes() };
    }

    it("races gemini-3.1-flash-lite against the default model on the free tier", async () => {
      expect(await modelsCalled({})).toEqual({
        models: ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite"],
        takes: 2, // each model spends its own rate-limit bucket
      });
    });

    it.each([
      ["LLM_HEDGE_MODEL=none", { LLM_HEDGE_MODEL: "none" }],
      ["the hedge model is the primary", { LLM_MODEL: "gemini-3.1-flash-lite" }],
      ["the paid tier", { LLM_TIER: "paid", SPEND_CAP_USD_MONTHLY: "5" }],
      ["record mode", { LLM_RECORD: "1" }],
    ])("is off for %s", async (_name, env) => {
      expect((await modelsCalled(env)).models).toHaveLength(1);
    });

    it("falls back to the hedge model when the primary fails", async () => {
      const models: string[] = [];
      const busy = new ApiError({ message: "overloaded", status: 503 });
      const { d } = deps({ geminiClient: client([busy, busy, busy], models) });
      const llm = createLLM({ LLM_HEDGE_AFTER_MS: "60000" }, d);
      expect((await llm.generate(testRequest(), Answer)).value).toEqual({ answer: "yes" });
      expect(models).toEqual([
        "gemini-3.5-flash-lite",
        "gemini-3.5-flash-lite",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
      ]);
    });
  });
});
