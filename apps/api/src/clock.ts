import type { Clock } from "@frontdesk/core";

/** Real time, shifted so `now()` starts at `startAt` (FRONTDESK_NOW, tests only). */
export function offsetClock(startAt?: Date): Clock {
  const offset = startAt ? startAt.getTime() - Date.now() : 0;
  return {
    now: () => new Date(Date.now() + offset),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
