import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { createKeyTag } from "@frontdesk/worker";
import { RedisBookingQuota } from "./booking-quota.js";

const tag = createKeyTag("test-secret");

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:63790");
const prefix = `test:${randomUUID()}:`;
afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();
});

describe("RedisBookingQuota", () => {
  it("counts per quota key and day, so +tags don't dodge it", async () => {
    const quota = new RedisBookingQuota(redis, tag, 2, prefix);
    expect(await quota.remaining("ana@example.com", "2026-11-04", "s1")).toBe(2);
    await quota.record(" ANA+1@example.com ", "2026-11-04", "s1");
    await quota.record("ana+2@example.com", "2026-11-04", "s2");
    expect(await quota.remaining("ana@example.com", "2026-11-04", "s3")).toBe(0);
    expect(await quota.remaining("ana@example.com", "2026-11-05", "s3")).toBe(2);
    expect(await redis.pttl((await redis.keys(`${prefix}*`))[0]!)).toBeGreaterThan(0);
  });

  it("caps one session across contacts", async () => {
    const quota = new RedisBookingQuota(redis, tag, 2, prefix);
    await quota.record("x1@example.com", "2026-11-04", "sess_many");
    await quota.record("x2@example.com", "2026-11-04", "sess_many");
    expect(await quota.remaining("x3@example.com", "2026-11-04", "sess_many")).toBe(0);
  });

  it("never stores the raw contact", async () => {
    const quota = new RedisBookingQuota(redis, tag, 2, prefix);
    await quota.record("+1 (555) 010-0199", "2026-11-04", "sess_raw");
    const keys = await redis.keys(`${prefix}*`);
    expect(keys.join(" ")).not.toMatch(/555|0100199|ana|sess_raw/);
  });
});
