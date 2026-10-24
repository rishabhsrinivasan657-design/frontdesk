import type { SpeechToText, SttHandlers, TextToSpeech } from "./types";

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
