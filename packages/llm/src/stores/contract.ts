import { describe, expect, it } from "vitest";
import type { CacheStore, RateLimitStore, SpendStore } from "./types.js";

export interface StoreFactories {
  rate(): RateLimitStore | Promise<RateLimitStore>;
  spend(): SpendStore | Promise<SpendStore>;
  /** A cache store plus a way to let `ms` pass for its TTL clock. */
  cache():
    | { store: CacheStore; advance: (ms: number) => Promise<void> }
    | Promise<{ store: CacheStore; advance: (ms: number) => Promise<void> }>;
}

const T0 = Date.parse("2026-10-22T18:00:00Z");
const DAY = "2026-10-22";
const DAY_ENDS = 7 * 3600_000;

/** Shared behavior every store implementation must have (memory in unit, Redis in infra). */
export function runStoreContracts(name: string, make: StoreFactories): void {
  describe(`${name} RateLimitStore`, () => {
    const take = (store: RateLimitStore, rpm: number, rpd: number, nowMs = T0, day = DAY) =>
      store.take("model-a", { limits: { rpm, rpd }, nowMs, day, dayEndsInMs: DAY_ENDS });

    it("rpm bucket allows rpm takes then refuses with retryAfterMs ≈ 60000/rpm", async () => {
      const store = await make.rate();
      for (let i = 0; i < 10; i++) expect(await take(store, 10, 500)).toEqual({ ok: true });
      expect(await take(store, 10, 500)).toEqual({ ok: false, retryAfterMs: 6000 });
    });

    it("bucket refills over time", async () => {
      const store = await make.rate();
      for (let i = 0; i < 10; i++) await take(store, 10, 500);
      expect((await take(store, 10, 500, T0 + 5999)).ok).toBe(false);
      expect(await take(store, 10, 500, T0 + 6000)).toEqual({ ok: true });
    });

    it("rpd refuses after rpd takes on one day and allows on the next day", async () => {
      const store = await make.rate();
      for (let i = 0; i < 3; i++) expect((await take(store, 100, 3)).ok).toBe(true);
      expect(await take(store, 100, 3)).toEqual({ ok: false, retryAfterMs: DAY_ENDS });
      expect((await take(store, 100, 3, T0 + 1000, "2026-10-23")).ok).toBe(true);
    });

    it("a refused take does not consume an rpm token", async () => {
      const store = await make.rate();
      expect((await take(store, 2, 1)).ok).toBe(true);
      expect((await take(store, 2, 1)).ok).toBe(false); // day exhausted
      expect((await take(store, 2, 1, T0, "2026-10-23")).ok).toBe(true); // second rpm token still there
    });

    it("models are limited independently", async () => {
      const store = await make.rate();
      await take(store, 1, 10);
      const other = await store.take("model-b", {
        limits: { rpm: 1, rpd: 10 },
        nowMs: T0,
        day: DAY,
        dayEndsInMs: DAY_ENDS,
      });
      expect(other).toEqual({ ok: true });
    });
  });

  describe(`${name} SpendStore`, () => {
    it("starts at zero", async () => {
      const store = await make.spend();
      expect(await store.get("2026-10")).toEqual({
        usd: 0,
        shadowUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      });
    });

    it("spend accumulates per month independently", async () => {
      const store = await make.spend();
      await store.add("2026-10", { usd: 0.5, shadowUsd: 0.75, inputTokens: 100, outputTokens: 20 });
      await store.add("2026-10", { usd: 0.25, shadowUsd: 0.25, inputTokens: 1, outputTokens: 2 });
      await store.add("2026-11", { usd: 1, shadowUsd: 1, inputTokens: 5, outputTokens: 5 });
      const oct = await store.get("2026-10");
      expect(oct.usd).toBeCloseTo(0.75, 10);
      expect(oct.shadowUsd).toBeCloseTo(1, 10);
      expect(oct).toMatchObject({ inputTokens: 101, outputTokens: 22 });
      expect((await store.get("2026-11")).usd).toBeCloseTo(1, 10);
    });
  });

  describe(`${name} CacheStore`, () => {
    it("returns what was set and undefined for a miss", async () => {
      const { store } = await make.cache();
      await store.set("k1", "v1", 60);
      expect(await store.get("k1")).toBe("v1");
      expect(await store.get("nope")).toBeUndefined();
    });

    it("cache expires after ttl", async () => {
      const { store, advance } = await make.cache();
      await store.set("k2", "v2", 1);
      await advance(1100);
      expect(await store.get("k2")).toBeUndefined();
    });
  });
}
