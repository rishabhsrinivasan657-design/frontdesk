import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { MAX_LOGIN_FAILURES, RedisOwnerSessionStore } from "./session-store.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:63790");
afterAll(() => redis.disconnect());

describe("RedisOwnerSessionStore", () => {
  it("creates, validates, expires and destroys sessions", async () => {
    const store = new RedisOwnerSessionStore(redis, 60_000);
    const id = await store.create();
    expect(await store.valid(id)).toBe(true);
    expect(await redis.pttl(`owner:sess:${id}`)).toBeGreaterThan(50_000);
    await store.destroy(id);
    expect(await store.valid(id)).toBe(false);
    const short = await new RedisOwnerSessionStore(redis, 50).create();
    await new Promise((r) => setTimeout(r, 120));
    expect(await store.valid(short)).toBe(false);
  });

  it("never looks up a malformed id", async () => {
    const store = new RedisOwnerSessionStore(redis, 60_000);
    await redis.set("owner:sess:*", "1", "PX", 5_000);
    expect(await store.valid("*")).toBe(false);
    expect(await store.valid("x".repeat(10_000))).toBe(false);
  });

  it("counts failures per IP within a window", async () => {
    const store = new RedisOwnerSessionStore(redis, 60_000);
    const ip = `test-${randomUUID()}`;
    for (let i = 0; i < MAX_LOGIN_FAILURES; i++) await store.recordFailure(ip);
    expect(await store.failures(ip)).toBe(MAX_LOGIN_FAILURES);
    expect(await redis.pttl(`owner:fail:${ip}`)).toBeGreaterThan(14 * 60_000);
    expect(await store.failures(`test-${randomUUID()}`)).toBe(0);
    await redis.del(`owner:fail:${ip}`);
  });
});
