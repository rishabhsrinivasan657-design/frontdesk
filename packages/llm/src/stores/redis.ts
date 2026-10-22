import type { Redis } from "ioredis";
import type {
  CacheStore,
  RateLimitStore,
  SpendStore,
  SpendTotals,
  TakeOptions,
  TakeResult,
} from "./types.js";

/**
 * Atomic RPD check + RPM token bucket; mirrors MemoryRateLimitStore. A refused take writes nothing.
 * KEYS: bucket hash, day counter. ARGV: rpm, rpd, nowMs, dayEndsInMs. Returns {ok, retryAfterMs}.
 */
const TAKE_SCRIPT = `
local rpm = tonumber(ARGV[1])
local rpd = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local used = tonumber(redis.call('GET', KEYS[2]) or '0')
if used >= rpd then return {0, tonumber(ARGV[4])} end
local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts = tonumber(bucket[2])
if tokens == nil then tokens = rpm; ts = now end
tokens = math.min(rpm, tokens + math.max(0, now - ts) * rpm / 60000)
if tokens < 1 then return {0, math.ceil((1 - tokens) * 60000 / rpm)} end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens - 1), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], 120000)
redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], 172800000)
return {1, 0}
`;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}

  async take(model: string, { limits, nowMs, day, dayEndsInMs }: TakeOptions): Promise<TakeResult> {
    const [ok, retryAfterMs] = (await this.redis.eval(
      TAKE_SCRIPT,
      2,
      `llm:rl:${model}:min`,
      `llm:rl:${model}:day:${day}`,
      limits.rpm,
      limits.rpd,
      nowMs,
      dayEndsInMs,
    )) as [number, number];
    return ok === 1 ? { ok: true } : { ok: false, retryAfterMs };
  }
}

const SPEND_FIELDS = ["usd", "shadowUsd", "inputTokens", "outputTokens"] as const;
const SPEND_TTL_SEC = 40 * 86_400;

export class RedisSpendStore implements SpendStore {
  constructor(private readonly redis: Redis) {}

  async add(month: string, entry: SpendTotals): Promise<void> {
    const key = `llm:spend:${month}`;
    const tx = this.redis.multi();
    for (const field of SPEND_FIELDS) tx.hincrbyfloat(key, field, entry[field]);
    tx.expire(key, SPEND_TTL_SEC);
    await tx.exec();
  }

  async get(month: string): Promise<SpendTotals> {
    const raw = await this.redis.hgetall(`llm:spend:${month}`);
    const num = (field: string) => Number(raw[field] ?? 0);
    return {
      usd: num("usd"),
      shadowUsd: num("shadowUsd"),
      inputTokens: num("inputTokens"),
      outputTokens: num("outputTokens"),
    };
  }
}

export class RedisCacheStore implements CacheStore {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | undefined> {
    return (await this.redis.get(key)) ?? undefined;
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    await this.redis.set(key, value, "EX", ttlSec);
  }
}
