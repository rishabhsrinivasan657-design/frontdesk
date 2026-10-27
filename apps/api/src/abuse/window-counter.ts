import type { Redis } from "ioredis";

/** Counts hits per key in a fixed window that starts at the key's first hit. */
export interface WindowCounter {
  /** Records one hit and returns the count in the current window, this hit included. */
  hit(key: string, windowMs: number): Promise<number>;
}

export { createKeyTag, type KeyTag } from "@frontdesk/worker";

/** One api process; tests. */
export class MemoryWindowCounter implements WindowCounter {
  private readonly windows = new Map<string, { count: number; endsAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, windowMs: number): Promise<number> {
    const now = this.now();
    const current = this.windows.get(key);
    const window = current && now < current.endsAt ? current : { count: 0, endsAt: now + windowMs };
    window.count += 1;
    this.windows.set(key, window);
    return Promise.resolve(window.count);
  }
}

/** INCR, plus an expiry set only on the window's first hit. */
export class RedisWindowCounter implements WindowCounter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "rl:",
  ) {}

  async hit(key: string, windowMs: number): Promise<number> {
    const k = this.prefix + key;
    const result = await this.redis.multi().incr(k).pexpire(k, windowMs, "NX").exec();
    const [error, count] = result?.[0] ?? [new Error("redis transaction aborted"), 0];
    if (error) throw error;
    return Number(count);
  }
}
