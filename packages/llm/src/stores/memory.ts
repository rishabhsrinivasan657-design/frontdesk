import type {
  CacheStore,
  RateLimitStore,
  SpendStore,
  SpendTotals,
  TakeOptions,
  TakeResult,
} from "./types.js";

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { tokens: number; ts: number }>();
  private readonly days = new Map<string, number>();

  take(model: string, { limits, nowMs, day, dayEndsInMs }: TakeOptions): Promise<TakeResult> {
    const dayKey = `${model}:${day}`;
    const used = this.days.get(dayKey) ?? 0;
    if (used >= limits.rpd) return Promise.resolve({ ok: false, retryAfterMs: dayEndsInMs });

    const bucket = this.buckets.get(model) ?? { tokens: limits.rpm, ts: nowMs };
    const elapsed = Math.max(0, nowMs - bucket.ts);
    const tokens = Math.min(limits.rpm, bucket.tokens + (elapsed * limits.rpm) / 60_000);
    if (tokens < 1) {
      return Promise.resolve({
        ok: false,
        retryAfterMs: Math.ceil(((1 - tokens) * 60_000) / limits.rpm),
      });
    }
    this.buckets.set(model, { tokens: tokens - 1, ts: nowMs });
    this.days.set(dayKey, used + 1);
    return Promise.resolve({ ok: true });
  }
}

const ZERO: SpendTotals = { usd: 0, shadowUsd: 0, inputTokens: 0, outputTokens: 0 };

export class MemorySpendStore implements SpendStore {
  private readonly months = new Map<string, SpendTotals>();

  add(month: string, entry: SpendTotals): Promise<void> {
    const t = this.months.get(month) ?? ZERO;
    this.months.set(month, {
      usd: t.usd + entry.usd,
      shadowUsd: t.shadowUsd + entry.shadowUsd,
      inputTokens: t.inputTokens + entry.inputTokens,
      outputTokens: t.outputTokens + entry.outputTokens,
    });
    return Promise.resolve();
  }

  get(month: string): Promise<SpendTotals> {
    return Promise.resolve({ ...(this.months.get(month) ?? ZERO) });
  }
}

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: string): Promise<string | undefined> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, ttlSec: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.now() + ttlSec * 1000 });
    return Promise.resolve();
  }
}
