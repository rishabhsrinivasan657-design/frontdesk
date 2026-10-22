import type { Clock } from "../../ports/clock.js";

/** A clock that only moves when told to; `sleep` advances it instead of waiting. */
export class ManualClock implements Clock {
  private ms: number;

  constructor(start: Date) {
    this.ms = start.getTime();
  }

  now(): Date {
    return new Date(this.ms);
  }

  advance(ms: number): void {
    this.ms += ms;
  }

  sleep(ms: number): Promise<void> {
    this.advance(ms);
    return Promise.resolve();
  }
}
