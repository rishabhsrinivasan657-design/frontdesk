import { type BookingQuota, normalizeContact } from "@frontdesk/core";
import type { Redis } from "ioredis";
import { keyTag } from "./window-counter.js";

/** Two days covers any business-day key in any timezone. */
const TTL_MS = 48 * 3_600_000;

/** Online bookings per contact per day in Redis (M10). Keys hold a hash, never the contact. */
export class RedisBookingQuota implements BookingQuota {
  constructor(
    private readonly redis: Redis,
    private readonly limit = 2,
    private readonly prefix = "bq:",
  ) {}

  private key(contact: string, day: string): string {
    return `${this.prefix}${keyTag(normalizeContact(contact))}:${day}`;
  }

  async remaining(contact: string, day: string): Promise<number> {
    const used = Number((await this.redis.get(this.key(contact, day))) ?? 0);
    return Math.max(0, this.limit - used);
  }

  async record(contact: string, day: string): Promise<void> {
    const key = this.key(contact, day);
    await this.redis.multi().incr(key).pexpire(key, TTL_MS).exec();
  }
}
