import type { BookingQuota } from "../../ports/booking-quota.js";
import { quotaKey } from "../../ports/quota-key.js";

export class InMemoryBookingQuota implements BookingQuota {
  private readonly counts = new Map<string, number>();
  constructor(private readonly limit: number) {}

  private keys(contact: string, day: string, sessionId: string): [string, string] {
    return [`c|${quotaKey(contact)}|${day}`, `s|${sessionId}`];
  }

  remaining(contact: string, day: string, sessionId: string): Promise<number> {
    const used = Math.max(
      ...this.keys(contact, day, sessionId).map((k) => this.counts.get(k) ?? 0),
    );
    return Promise.resolve(Math.max(0, this.limit - used));
  }

  record(contact: string, day: string, sessionId: string): Promise<void> {
    for (const key of this.keys(contact, day, sessionId)) {
      this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    }
    return Promise.resolve();
  }
}
