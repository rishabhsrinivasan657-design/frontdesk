import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { RedisBookingQuota } from "./booking-quota.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:63790");
const prefix = `test:${randomUUID()}:`;
afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();
});

describe("RedisBookingQuota", () => {
  it("counts per normalized contact and day", async () => {
    const quota = new RedisBookingQuota(redis, 2, prefix);
    expect(await quota.remaining("ana@example.com", "2026-11-04")).toBe(2);
    await quota.record(" ANA@example.com ", "2026-11-04");
    await quota.record("ana@example.com", "2026-11-04");
    expect(await quota.remaining("ana@example.com", "2026-11-04")).toBe(0);
    expect(await quota.remaining("ana@example.com", "2026-11-05")).toBe(2);
    expect(await redis.pttl((await redis.keys(`${prefix}*`))[0]!)).toBeGreaterThan(0);
  });

  it("never stores the raw contact", async () => {
    const quota = new RedisBookingQuota(redis, 2, prefix);
    await quota.record("+1 (555) 010-0199", "2026-11-04");
    const keys = await redis.keys(`${prefix}*`);
    expect(keys.join(" ")).not.toMatch(/555|0100199|ana/);
  });
});
