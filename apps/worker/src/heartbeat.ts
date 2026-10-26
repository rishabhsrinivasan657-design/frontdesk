/** The api's `/health/ready` reads this key: present means the worker ran in the last 3 minutes. */
export const HEARTBEAT_KEY = "worker:heartbeat";
const EVERY_MS = 60_000;
const TTL_MS = 180_000;

/** Writes the heartbeat now and every minute until stopped. */
export function startHeartbeat(redis: {
  set(key: string, value: string, px: "PX", ms: number): Promise<unknown>;
}): () => void {
  const beat = () =>
    void redis.set(HEARTBEAT_KEY, new Date().toISOString(), "PX", TTL_MS).catch(() => undefined);
  beat();
  const timer = setInterval(beat, EVERY_MS);
  return () => clearInterval(timer);
}
