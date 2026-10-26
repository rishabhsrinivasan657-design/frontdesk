import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { RedisWindowCounter } from "./window-counter.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:63790");
const prefix = `test:${randomUUID()}:`;
afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();
});

describe("RedisWindowCounter", () => {
  it("counts hits and expires the window", async () => {
    const counter = new RedisWindowCounter(redis, prefix);
    expect(await counter.hit("k", 150)).toBe(1);
    expect(await counter.hit("k", 150)).toBe(2);
    const ttl = await redis.pttl(`${prefix}k`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(150);
    await new Promise((r) => setTimeout(r, 200));
    expect(await counter.hit("k", 150)).toBe(1);
  });

  it("a later hit doesn't extend the window", async () => {
    const counter = new RedisWindowCounter(redis, prefix);
    await counter.hit("w", 10_000);
    await redis.pexpire(`${prefix}w`, 500);
    await counter.hit("w", 10_000);
    expect(await redis.pttl(`${prefix}w`)).toBeLessThanOrEqual(500);
  });
});
