import { randomUUID } from "node:crypto";
import { createKeyTag } from "@frontdesk/worker";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { MAX_LOGIN_FAILURES, RedisOwnerSessionStore } from "./session-store.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:63790");
const tag = createKeyTag("test-secret");
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

  it("counts attempts per IP atomically within a window, and clears them", async () => {
    const store = new RedisOwnerSessionStore(redis, 60_000, tag);
    const ip = `test-${randomUUID()}`;
    const counts = await Promise.all(Array.from({ length: 10 }, () => store.attempt(ip)));
    expect([...counts].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await redis.pttl(`owner:fail:${tag(ip)}`)).toBeGreaterThan(14 * 60_000);
    await store.clearAttempts(ip);
    expect(await store.attempt(ip)).toBe(1);
    expect(MAX_LOGIN_FAILURES).toBe(5);
    await redis.del(`owner:fail:${tag(ip)}`);
  });

  it("never stores the raw address", async () => {
    const store = new RedisOwnerSessionStore(redis, 60_000, tag);
    await store.attempt("203.0.113.77");
    expect((await redis.keys("owner:fail:*")).join(" ")).not.toContain("203.0.113.77");
    await redis.del(`owner:fail:${tag("203.0.113.77")}`);
  });
});
