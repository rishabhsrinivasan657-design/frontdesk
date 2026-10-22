import type { Clock } from "../../ports/clock.js";
import type { Lease, SlotLock } from "../../ports/slot-lock.js";

export class InMemorySlotLock implements SlotLock {
  /** key → [lease token, expiry ms]. */
  private readonly held = new Map<string, [object, number]>();

  constructor(private readonly clock: Clock) {}

  acquire(key: string, ttlMs: number): Promise<Lease | undefined> {
    const now = this.clock.now().getTime();
    const current = this.held.get(key);
    if (current && current[1] > now) return Promise.resolve(undefined);
    const token = {};
    this.held.set(key, [token, now + ttlMs]);
    return Promise.resolve({
      release: () => {
        // A lease that expired and was re-acquired by someone else must not free their hold.
        if (this.held.get(key)?.[0] === token) this.held.delete(key);
        return Promise.resolve();
      },
    });
  }
}
