import type { BookingQuota } from "../../ports/booking-quota.js";
import { normalizeContact } from "../../ports/calendar.js";

export class InMemoryBookingQuota implements BookingQuota {
  private readonly counts = new Map<string, number>();
  constructor(private readonly limit: number) {}

  private key(contact: string, day: string): string {
    return `${normalizeContact(contact)}|${day}`;
  }

  remaining(contact: string, day: string): Promise<number> {
    return Promise.resolve(
      Math.max(0, this.limit - (this.counts.get(this.key(contact, day)) ?? 0)),
    );
  }

  record(contact: string, day: string): Promise<void> {
    const key = this.key(contact, day);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    return Promise.resolve();
  }
}
