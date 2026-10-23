import { describe, expect, it } from "vitest";
import { offsetClock } from "./clock.js";

describe("offsetClock", () => {
  it("starts at startAt and moves with real time", async () => {
    const clock = offsetClock(new Date("2026-11-04T19:00:00Z"));
    const first = clock.now().getTime();
    expect(Math.abs(first - Date.parse("2026-11-04T19:00:00Z"))).toBeLessThan(50);
    await clock.sleep(20);
    expect(clock.now().getTime() - first).toBeGreaterThanOrEqual(15);
  });

  it("is real time without startAt", () => {
    expect(Math.abs(offsetClock().now().getTime() - Date.now())).toBeLessThan(50);
  });
});
