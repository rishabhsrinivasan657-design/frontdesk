import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { RedisSessionStore } from "./session-store.js";
import { pendingFor, runSessionStoreContract, uniqueId } from "./session-store-contract.js";
import { RedisSlotLock } from "./slot-lock.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:63790");
const prefix = `test:${randomUUID()}:`;
afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();
});

// The contract's pending actions expire at a fixed 2026 time; measure TTLs from the same clock.
const FIXTURE_NOW = Date.parse("2026-11-04T14:00:00-05:00");
runSessionStoreContract("redis", () =>
  Promise.resolve(new RedisSessionStore(redis, { prefix, now: () => FIXTURE_NOW })),
);

describe("RedisSessionStore", () => {
  it("takePending is atomic under 20 concurrent calls", async () => {
    const store = new RedisSessionStore(redis, { prefix, now: () => FIXTURE_NOW });
    const id = uniqueId("sess");
    await store.putPending(pendingFor(id, "act_1"));
    const taken = await Promise.all(
      Array.from({ length: 20 }, () => store.takePending(id, "act_1")),
    );
    expect(taken.filter(Boolean)).toHaveLength(1);
  });

  it("a pending action outlives expiresAt by the grace, then disappears", async () => {
    let now = Date.parse("2026-11-04T14:00:00-05:00");
    const store = new RedisSessionStore(redis, { prefix, pendingGraceMs: 150, now: () => now });
    const id = uniqueId("sess");
    // Expires 50 ms after "now": the key lives 50 + 150 ms.
    await store.putPending(pendingFor(id, "act_1", new Date(now + 50).toISOString()));
    now += 100;
    await new Promise((r) => setTimeout(r, 100));
    expect((await store.getPending(id))?.id).toBe("act_1");
    await new Promise((r) => setTimeout(r, 250));
    expect(await store.getPending(id)).toBeUndefined();
  });
});

describe("RedisSlotLock", () => {
  it("refuses a second acquire until release", async () => {
    const locks = new RedisSlotLock(redis, { prefix });
    const key = uniqueId("slot");
    const lease = await locks.acquire(key, 5000);
    expect(lease).toBeDefined();
    expect(await locks.acquire(key, 5000)).toBeUndefined();
    await lease!.release();
    expect(await locks.acquire(key, 5000)).toBeDefined();
  });

  it("a stale lease can't free a re-acquired key", async () => {
    const locks = new RedisSlotLock(redis, { prefix });
    const key = uniqueId("slot");
    const stale = await locks.acquire(key, 50);
    await new Promise((r) => setTimeout(r, 120));
    const fresh = await locks.acquire(key, 5000);
    expect(fresh).toBeDefined();
    await stale!.release();
    expect(await locks.acquire(key, 5000)).toBeUndefined();
  });
});
