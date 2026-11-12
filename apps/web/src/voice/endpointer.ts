import { turnCompleteness } from "./turn-text";
import type { Timers } from "./web-speech";

/**
 * Silence windows: how long the caller must be quiet before we take the turn, by how finished
 * the words sound (spec §5.3). Starting values; tuning is one edit here.
 */
export const COMPLETE_MS = 300;
export const NEUTRAL_MS = 700;
export const INCOMPLETE_MS = 2000;
/** However unfinished it sounds, this much silence ends the turn. */
export const HARD_CAP_MS = 3000;
/** Web Speech words lag the audio: wait until the text has been unchanged this long… */
export const STABLE_MS = 200;
/** …but never more than this past the window. */
export const MAX_CATCHUP_MS = 600;
/** The neutral window adapts to the caller's own mid-sentence pauses, within these bounds. */
const ADAPT_MAX_MS = 1500;
const ADAPT_MIN_SAMPLES = 3;
const KEEP_PAUSES = 20;

export interface EndpointerOptions {
  timers: Timers;
  now: () => number;
  /** The caller has finished: `text` is the whole utterance, `speechEnd` when they went quiet. */
  onEndOfTurn(text: string, speechEnd: number): void;
}

/**
 * Decides when the caller has finished speaking (endpointing). A VAD tells us when they go quiet
 * and start again; the words tell us how long to wait. "Yes" ends the turn after 300 ms, "a table
 * for" waits 2 s, and anything else waits 700 ms, raised for callers who pause a lot.
 * One `onEndOfTurn` per utterance, until `reset()`.
 */
export class Endpointer {
  private text = "";
  private changedAt = -Infinity;
  /** When the current silence began; undefined while the caller is speaking. */
  private endAt: number | undefined;
  private timer: unknown;
  private emitted = false;
  /** Silences that turned out to be mid-sentence pauses (speech came back), newest last. */
  private readonly pauses: number[] = [];

  constructor(private readonly o: EndpointerOptions) {}

  get neutralMs(): number {
    if (this.pauses.length < ADAPT_MIN_SAMPLES) return NEUTRAL_MS;
    const sorted = [...this.pauses].sort((a, b) => a - b);
    const p90 = sorted[Math.ceil(0.9 * sorted.length) - 1]!;
    return Math.min(ADAPT_MAX_MS, Math.max(NEUTRAL_MS, p90 + 100));
  }

  speechStart(): void {
    if (this.emitted) return;
    if (this.endAt !== undefined && this.timer !== undefined) {
      this.pauses.push(this.o.now() - this.endAt);
      if (this.pauses.length > KEEP_PAUSES) this.pauses.shift();
    }
    this.clear();
    this.endAt = undefined;
  }

  speechEnd(at: number = this.o.now()): void {
    if (this.emitted) return;
    this.endAt = at;
    this.arm();
  }

  transcript(text: string): void {
    if (this.emitted || text === this.text) return;
    this.text = text;
    this.changedAt = this.o.now();
    if (this.endAt !== undefined) this.arm();
  }

  flush(): void {
    if (this.emitted || !this.text) return;
    this.emit(this.endAt ?? this.o.now());
  }

  reset(): void {
    this.clear();
    this.text = "";
    this.changedAt = -Infinity;
    this.endAt = undefined;
    this.emitted = false;
  }

  private window(): number {
    switch (turnCompleteness(this.text)) {
      case "complete":
        return COMPLETE_MS;
      case "incomplete":
        return INCOMPLETE_MS;
      default:
        return this.neutralMs;
    }
  }

  private arm(): void {
    this.clear();
    const endAt = this.endAt!;
    // Nothing heard yet: wait for words up to the hard cap, then give up quietly.
    const fireAt = !this.text
      ? endAt + HARD_CAP_MS
      : Math.min(
          endAt + HARD_CAP_MS,
          Math.max(
            endAt + this.window(),
            Math.min(this.changedAt + STABLE_MS, endAt + this.window() + MAX_CATCHUP_MS),
          ),
        );
    const delay = fireAt - this.o.now();
    if (delay <= 0) {
      this.fire();
      return;
    }
    this.timer = this.o.timers.set(() => {
      this.timer = undefined;
      this.fire();
    }, delay);
  }

  private fire(): void {
    if (this.text) this.emit(this.endAt!);
    else this.endAt = undefined;
  }

  private emit(speechEnd: number): void {
    this.clear();
    this.emitted = true;
    this.o.onEndOfTurn(this.text, speechEnd);
  }

  private clear(): void {
    if (this.timer !== undefined) this.o.timers.clear(this.timer);
    this.timer = undefined;
  }
}
