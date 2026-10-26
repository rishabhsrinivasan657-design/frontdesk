import { afterEach, describe, expect, it, vi } from "vitest";
import { HEARTBEAT_KEY, startHeartbeat } from "./heartbeat.js";

afterEach(() => vi.useRealTimers());

describe("startHeartbeat", () => {
  it("writes the key at once and every minute, with a 3 minute expiry", async () => {
    vi.useFakeTimers();
    const sets: unknown[][] = [];
    const redis = { set: (...a: unknown[]) => (sets.push(a), Promise.resolve("OK")) };
    const stop = startHeartbeat(redis);
    await vi.advanceTimersByTimeAsync(0);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toEqual([HEARTBEAT_KEY, expect.any(String), "PX", 180_000]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sets).toHaveLength(2);
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sets).toHaveLength(2);
  });

  it("a failed write doesn't crash the worker", async () => {
    vi.useFakeTimers();
    const redis = { set: () => Promise.reject(new Error("redis down")) };
    const stop = startHeartbeat(redis);
    await vi.advanceTimersByTimeAsync(60_000);
    stop();
  });
});
