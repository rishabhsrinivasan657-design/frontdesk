import { type BookingQuota, quotaKey } from "@frontdesk/core";
import type { KeyTag } from "@frontdesk/worker";
import type { Redis } from "ioredis";

/** Two days covers any business-day key in any timezone. */
const DAY_TTL_MS = 48 * 3_600_000;
/** Outlives any chat session, so a session's count never refills. */
const SESSION_TTL_MS = 30 * 24 * 3_600_000;

/**
 * Online bookings per contact per day, and per chat session, in Redis (M10). Keys hold keyed
 * hashes, never the contact or the session id.
 */
export class RedisBookingQuota implements BookingQuota {
  constructor(
    private readonly redis: Redis,
    private readonly tag: KeyTag,
    private readonly limit = 2,
    private readonly prefix = "bq:",
  ) {}

  private keys(contact: string, day: string, sessionId: string) {
    return {
      contact: `${this.prefix}c:${this.tag(quotaKey(contact))}:${day}`,
      session: `${this.prefix}s:${this.tag(sessionId)}`,
    };
  }

  async remaining(contact: string, day: string, sessionId: string): Promise<number> {
    const k = this.keys(contact, day, sessionId);
    const [c, s] = await this.redis.mget(k.contact, k.session);
    return Math.max(0, this.limit - Math.max(Number(c ?? 0), Number(s ?? 0)));
  }

  async record(contact: string, day: string, sessionId: string): Promise<void> {
    const k = this.keys(contact, day, sessionId);
    await this.redis
      .multi()
      .incr(k.contact)
      .pexpire(k.contact, DAY_TTL_MS)
      .incr(k.session)
      .pexpire(k.session, SESSION_TTL_MS)
      .exec();
  }
}
