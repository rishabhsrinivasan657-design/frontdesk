import { ManualClock } from "@frontdesk/core";
import { describe, expect, it } from "vitest";
import { RETENTION_DAYS, runRetention } from "./retention-job.js";

describe("runRetention", () => {
  it("redacts pilot data and the calendar older than 30 days and logs counts only", async () => {
    const now = new Date("2026-12-31T09:00:00.000Z");
    const cutoffs: Date[] = [];
    const lines: string[] = [];
    const result = await runRetention({
      clock: new ManualClock(now),
      purge: (o) => (cutoffs.push(o.before), Promise.resolve({ conversations: 3 })),
      redactCalendar: (before) => (cutoffs.push(before), Promise.resolve(2)),
      log: (line) => lines.push(line),
    });
    expect(RETENTION_DAYS).toBe(30);
    const expected = new Date(now.getTime() - 30 * 86_400_000);
    expect(cutoffs).toEqual([expected, expected]);
    expect(result).toEqual({ conversations: 3, calendarEvents: 2 });
    expect(lines).toEqual(["retention: 3 conversations, 2 calendar events redacted"]);
  });

  it("works without a calendar", async () => {
    const result = await runRetention({
      clock: new ManualClock(new Date("2026-12-31T09:00:00.000Z")),
      purge: () => Promise.resolve({ conversations: 0 }),
      log: () => undefined,
    });
    expect(result).toEqual({ conversations: 0, calendarEvents: 0 });
  });
});
