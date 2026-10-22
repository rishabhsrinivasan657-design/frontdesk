import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll } from "vitest";
import { runStoreContracts } from "./contract.js";
import { RedisCacheStore, RedisRateLimitStore, RedisSpendStore } from "./redis.js";

const url = process.env.REDIS_URL ?? "redis://localhost:63790";
const run = `fdtest:${randomUUID()}:`;
const clients: Redis[] = [];

/** A connection whose keys live under a fresh prefix, so each store starts empty. */
function client(): Redis {
  const redis = new Redis(url, { keyPrefix: `${run}${clients.length}:`, maxRetriesPerRequest: 1 });
  clients.push(redis);
  return redis;
}

afterAll(async () => {
  const admin = new Redis(url);
  const keys = await admin.keys(`${run}*`);
  if (keys.length) await admin.del(...keys);
  admin.disconnect();
  for (const c of clients) c.disconnect();
});

runStoreContracts("redis", {
  rate: () => new RedisRateLimitStore(client()),
  spend: () => new RedisSpendStore(client()),
  cache: () => ({
    store: new RedisCacheStore(client()),
    advance: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }),
});
