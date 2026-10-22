export interface RateLimits {
  rpm: number;
  rpd: number;
}

export interface TakeOptions {
  limits: RateLimits;
  nowMs: number;
  /** Quota day key (Pacific date). */
  day: string;
  /** Reported as retryAfterMs when the day's quota is exhausted. */
  dayEndsInMs: number;
}

export type TakeResult = { ok: true } | { ok: false; retryAfterMs: number };

/** Per-model token bucket (RPM) plus a daily counter (RPD). A refused take changes nothing. */
export interface RateLimitStore {
  take(model: string, options: TakeOptions): Promise<TakeResult>;
}

export interface SpendTotals {
  usd: number;
  /** What the calls would have cost on the paid tier ("≈$x if paid"). */
  shadowUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface SpendStore {
  add(month: string, entry: SpendTotals): Promise<void>;
  get(month: string): Promise<SpendTotals>;
}

export interface CacheStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
}
