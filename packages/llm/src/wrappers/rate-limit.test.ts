import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeProvider } from "../providers/fake.js";
import { MemoryRateLimitStore } from "../stores/memory.js";
import type { RateLimitStore } from "../stores/types.js";
import { collect, testRequest } from "../test-request.js";
import { withRateLimit } from "./rate-limit.js";

const now = () => Date.parse("2026-10-22T18:00:00Z");
const Answer = z.object({ answer: z.string() });

describe("withRateLimit", () => {
  it("passes through under the limit", async () => {
    const inner = new FakeProvider([{ stream: [{ type: "text", text: "hi" }] }]);
    const limited = withRateLimit(inner, {
      store: new MemoryRateLimitStore(),
      limits: { rpm: 1, rpd: 5 },
      now,
    });
    expect(await collect(limited.stream(testRequest()))).toEqual([{ type: "text", text: "hi" }]);
    expect(limited.model).toBe("fake");
  });

  it("throws rate_limited with retryAfterMs when empty, without calling inner", async () => {
    const inner = new FakeProvider([{ generate: { answer: "a" } }]);
    const limited = withRateLimit(inner, {
      store: new MemoryRateLimitStore(),
      limits: { rpm: 1, rpd: 5 },
      now,
    });
    await limited.generate(testRequest(), Answer);
    await expect(limited.generate(testRequest(), Answer)).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterMs: 60_000,
      retryable: false,
    });
    expect(inner.calls).toHaveLength(1);
  });

  it("applies to stream and generate", async () => {
    const inner = new FakeProvider([{ stream: [] }]);
    const limited = withRateLimit(inner, {
      store: new MemoryRateLimitStore(),
      limits: { rpm: 1, rpd: 5 },
      now,
    });
    await collect(limited.stream(testRequest()));
    await expect(collect(limited.stream(testRequest()))).rejects.toMatchObject({
      code: "rate_limited",
    });
    await expect(limited.generate(testRequest(), Answer)).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("an exhausted day reports the wait until Pacific midnight", async () => {
    const inner = new FakeProvider([{ stream: [] }]);
    const at = () => Date.parse("2026-11-03T07:59:00Z"); // 23:59 PST
    const limited = withRateLimit(inner, {
      store: new MemoryRateLimitStore(),
      limits: { rpm: 10, rpd: 1 },
      now: at,
    });
    await collect(limited.stream(testRequest()));
    await expect(collect(limited.stream(testRequest()))).rejects.toMatchObject({
      retryAfterMs: 60_000,
    });
  });

  it("no limits → never consults the store", async () => {
    const store: RateLimitStore = { take: () => Promise.reject(new Error("store touched")) };
    const limited = withRateLimit(new FakeProvider([{ stream: [] }]), { store });
    expect(await collect(limited.stream(testRequest()))).toEqual([]);
  });
});
