import { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { infraEnv } from "./env";

const UP_HINT = "Is Redis running? Try: pnpm infra:up (docker compose up -d)";

async function ping(url: string) {
  const redis = new Redis(url, {
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  redis.on("error", () => {}); // surfaced through connect() instead
  try {
    try {
      await redis.connect();
    } catch (e) {
      throw new Error(`${UP_HINT}\n${(e as Error).message}`);
    }
    return await redis.ping();
  } finally {
    redis.disconnect();
  }
}

describe("redis", () => {
  it("answers PING", async () => {
    expect(await ping(infraEnv().redisUrl)).toBe("PONG");
  });

  it("fails fast with an actionable message when nothing is listening", async () => {
    const started = Date.now();
    await expect(ping("redis://localhost:1")).rejects.toThrow(/docker compose up -d/);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
