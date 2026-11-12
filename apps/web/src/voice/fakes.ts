import type { SpeechToText, SttHandlers, TextToSpeech } from "./types";
import type { Timers, WebSpeechGlobals } from "./web-speech";

/** A TextToSpeech for unit tests: nothing plays until the test calls `start()` / `end()`. */
export class FakeTts implements TextToSpeech {
  readonly supported = true;
  readonly spoken: string[] = [];
  cancels = 0;
  volume = 1;
  private current: { onStart(): void; onEnd(): void } | undefined;
  setVolume(volume: number): void {
    this.volume = volume;
  }
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

export type Listener = (event?: unknown) => void;

/** Stands in for the browser's SpeechRecognition: the test fires its events. */
export class FakeRecognition {
  static last: FakeRecognition | undefined;
  lang = "";
  interimResults = false;
  continuous = true;
  started = 0;
  stopped = 0;
  onspeechstart: Listener | null = null;
  onspeechend: Listener | null = null;
  onresult: Listener | null = null;
  onerror: Listener | null = null;
  onend: Listener | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started += 1;
  }
  stop() {
    this.stopped += 1;
  }
  abort() {
    this.stopped += 1;
  }
  /** One result list, as the browser sends it: earlier results stay, the last may be interim. */
  result(parts: { text: string; final: boolean }[]) {
    const results = parts.map((p) => Object.assign([{ transcript: p.text }], { isFinal: p.final }));
    this.onresult?.({ resultIndex: 0, results });
  }
}

export function recordingHandlers(): SttHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onSpeechStart: () => calls.push("start"),
    onInterim: (t) => calls.push(`interim:${t}`),
    onFinal: (t, timings) => calls.push(`final:${t}:${JSON.stringify(timings)}`),
    onError: (e) => calls.push(`error:${e}`),
    onEnd: () => calls.push("end"),
  };
}

export const withRecognition = (): WebSpeechGlobals => ({
  webkitSpeechRecognition: FakeRecognition,
});

/** A Vad for unit tests: the test calls `speechStart()` / `speechEnd(at)`; `failStart` rejects. */
export class FakeVad {
  starts = 0;
  stops = 0;
  handlers: { onSpeechStart(): void; onSpeechEnd(at: number): void } | undefined;
  private release: (() => void) | undefined;
  /** `deferred`: `start` stays pending until the test calls `ready()` (the model is loading). */
  constructor(
    private readonly failStart = false,
    private readonly deferred = false,
  ) {}
  start(h: { onSpeechStart(): void; onSpeechEnd(at: number): void }): Promise<void> {
    this.starts += 1;
    this.handlers = h;
    if (this.failStart) return Promise.reject(new Error("no vad"));
    if (!this.deferred) return Promise.resolve();
    return new Promise((resolve) => (this.release = resolve));
  }
  /** Finishes a deferred start and lets its continuations run. */
  async ready(): Promise<void> {
    this.release?.();
    await Promise.resolve();
    await Promise.resolve();
  }
  stop(): void {
    this.stops += 1;
  }
  speechStart(): void {
    this.handlers?.onSpeechStart();
  }
  speechEnd(at: number): void {
    this.handlers?.onSpeechEnd(at);
  }
}
