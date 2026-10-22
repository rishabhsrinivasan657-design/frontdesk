export interface Lease {
  release(): Promise<void>;
}

/** Short-lived mutual exclusion on a slot while it is re-checked and written (spec §5). */
export interface SlotLock {
  /** A lease, or undefined if the key is already held. */
  acquire(key: string, ttlMs: number): Promise<Lease | undefined>;
}
