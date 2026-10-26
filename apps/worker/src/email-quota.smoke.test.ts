import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { RedisEmailQuota } from "./email-quota.js";
import { createKeyTag } from "./key-tag.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:63790");
const prefix = `test:${randomUUID()}:`;
afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();
});

describe("RedisEmailQuota", () => {
  it("caps per recipient and overall, with expiring keys that hold no address", async () => {
    const q = new RedisEmailQuota(redis, createKeyTag("t"), { perRecipient: 1, global: 2 }, prefix);
    expect(await q.take("Ana@Example.com", "2026-11-06")).toBe("ok");
    expect(await q.take("ana+spam@example.com", "2026-11-06")).toBe("recipient_cap");
    expect(await q.take("bo@example.com", "2026-11-06")).toBe("ok");
    expect(await q.take("cy@example.com", "2026-11-06")).toBe("global_cap");
    const keys = await redis.keys(`${prefix}*`);
    expect(keys.join(" ")).not.toMatch(/example|ana|bo@/i);
    for (const k of keys) expect(await redis.pttl(k)).toBeGreaterThan(0);
  });
});
