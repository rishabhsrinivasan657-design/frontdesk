import { quotaKey } from "@frontdesk/core";
import type { Redis } from "ioredis";
import { createKeyTag, type KeyTag } from "./key-tag.js";

export type EmailVerdict = "ok" | "recipient_cap" | "global_cap";

/** Daily caps on confirmation emails (M10): the agent must not become a spam relay. */
export interface EmailQuota {
  /** Counts one email to `to` on `day` (YYYY-MM-DD) unless a cap is reached. */
  take(to: string, day: string): Promise<EmailVerdict>;
}

export interface EmailCaps {
  perRecipient: number;
  global: number;
}
export const DEFAULT_EMAIL_CAPS: EmailCaps = { perRecipient: 3, global: 50 };

export class MemoryEmailQuota implements EmailQuota {
  private readonly counts = new Map<string, number>();
  constructor(private readonly caps: EmailCaps = DEFAULT_EMAIL_CAPS) {}

  take(to: string, day: string): Promise<EmailVerdict> {
    const r = `r:${quotaKey(to)}:${day}`;
    const g = `g:${day}`;
    if ((this.counts.get(r) ?? 0) >= this.caps.perRecipient)
      return Promise.resolve("recipient_cap");
    if ((this.counts.get(g) ?? 0) >= this.caps.global) return Promise.resolve("global_cap");
    this.counts.set(r, (this.counts.get(r) ?? 0) + 1);
    this.counts.set(g, (this.counts.get(g) ?? 0) + 1);
    return Promise.resolve("ok");
  }
}

const TTL_MS = 48 * 3_600_000;

/**
 * Counts in Redis. Over a cap the counter still went up, which is harmless: the cap was hit.
 * A refused recipient doesn't use up the global count.
 */
export class RedisEmailQuota implements EmailQuota {
  constructor(
    private readonly redis: Redis,
    /** Keys hold a keyed hash of the address, never the address. */
    private readonly tag: KeyTag = createKeyTag("dev"),
    private readonly caps: EmailCaps = DEFAULT_EMAIL_CAPS,
    private readonly prefix = "eq:",
  ) {}

  private async incr(key: string): Promise<number> {
    const result = await this.redis.multi().incr(key).pexpire(key, TTL_MS, "NX").exec();
    const [error, count] = result?.[0] ?? [new Error("redis transaction aborted"), 0];
    if (error) throw error;
    return Number(count);
  }

  async take(to: string, day: string): Promise<EmailVerdict> {
    if (
      (await this.incr(`${this.prefix}r:${this.tag(quotaKey(to))}:${day}`)) > this.caps.perRecipient
    ) {
      return "recipient_cap";
    }
    if ((await this.incr(`${this.prefix}g:${day}`)) > this.caps.global) return "global_cap";
    return "ok";
  }
}
