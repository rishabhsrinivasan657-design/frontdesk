import type { SpeechToText, SttHandlers, TextToSpeech } from "./types";
import type { Timers } from "./web-speech";

/** A TextToSpeech for unit tests: nothing plays until the test calls `start()` / `end()`. */
export class FakeTts implements TextToSpeech {
  readonly supported = true;
  readonly spoken: string[] = [];
  cancels = 0;
  private current: { onStart(): void; onEnd(): void } | undefined;
  speak(text: string, h: { onStart(): void; onEnd(): void }): void {
    this.spoken.push(text);
    this.current = h;
  }
  cancel(): void {
    this.cancels += 1;
    // Browsers fire `end` for a cancelled utterance.
    const h = this.current;
    this.current = undefined;
    h?.onEnd();
  }
  start(): void {
    this.current?.onStart();
  }
  end(): void {
    const h = this.current;
    this.current = undefined;
    h?.onEnd();
  }
}

/** A SpeechToText for unit tests: the test drives `handlers`. */
export class FakeStt implements SpeechToText {
  starts = 0;
  stops = 0;
  handlers: SttHandlers | undefined;
  constructor(readonly supported = true) {}
  start(h: SttHandlers): void {
    this.starts += 1;
    this.handlers = h;
  }
  stop(): void {
    this.stops += 1;
    this.handlers?.onEnd();
  }
}

/** A clock and timers the test moves by hand: `advance` fires timers that come due, in order. */
export function fakeClock() {
  let t = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { at: t + ms, fn });
      return id;
    },
    clear: (id) => pending.delete(id as number),
  };
  return {
    now: () => t,
    timers,
    pending: () => pending.size,
    set: (ms: number) => (t = ms),
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...pending].filter(([, p]) => p.at <= end).sort((a, b) => a[1].at - b[1].at);
        const first = due[0];
        if (!first) break;
        pending.delete(first[0]);
        t = first[1].at;
        first[1].fn();
      }
      t = end;
    },
  };
}
