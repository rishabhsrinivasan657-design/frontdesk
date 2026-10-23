import { randomUUID } from "node:crypto";
import type { Lease, SlotLock } from "@frontdesk/core";
import type { Redis } from "ioredis";

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

/** SET NX PX lock; a lease only releases the key while it still holds it (spec §5). */
export class RedisSlotLock implements SlotLock {
  private readonly prefix: string;

  constructor(
    private readonly redis: Redis,
    opts: { prefix?: string } = {},
  ) {
    this.prefix = opts.prefix ?? "fd:";
  }

  async acquire(key: string, ttlMs: number): Promise<Lease | undefined> {
    const lockKey = `${this.prefix}lock:${key}`;
    const token = randomUUID();
    const ok = await this.redis.set(lockKey, token, "PX", ttlMs, "NX");
    if (ok !== "OK") return undefined;
    return {
      release: async () => {
        await this.redis.eval(RELEASE_SCRIPT, 1, lockKey, token);
      },
    };
  }
}
