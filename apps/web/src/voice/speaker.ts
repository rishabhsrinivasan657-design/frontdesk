import type { TextToSpeech } from "./types";

export interface SpeakerOptions {
  /** The first sentence of a turn started playing: `at` (epoch ms) and the delay since it arrived. */
  onTtsStarted(turnId: string, at: number, sinceSentenceMs: number): void;
  onChange(speaking: boolean): void;
  now?: () => number;
}

/**
 * Speaks each reply sentence as it arrives (spec §8), one at a time, instead of waiting for the
 * whole reply. `stop()` is barge-in: it silences the current sentence, drops the queue, and stays
 * muted until `unmute()` (the caller's next message), so the rest of a cancelled turn isn't spoken.
 * Sentences that arrive while muted are kept: `replay()` speaks them when the turn turned out to
 * be uncancellable (a booking made, a read-back sent) and the caller must hear it.
 */
export class Speaker {
  private queue: { turnId: string; text: string }[] = [];
  private current: { turnId: string } | undefined;
  private muted = false;
  private missed: { turnId: string; text: string }[] = [];
  /** Bumped by `stop()`, so callbacks from a cancelled utterance are ignored. */
  private generation = 0;
  private readonly firstArrival = new Map<string, number>();
  private readonly started = new Set<string>();
  private readonly now: () => number;

  constructor(
    private readonly tts: TextToSpeech,
    private readonly opts: SpeakerOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  get speaking(): boolean {
    return this.current !== undefined || this.queue.length > 0;
  }

  enqueue(turnId: string, text: string): void {
    if (this.muted) {
      this.missed.push({ turnId, text });
      return;
    }
    if (!this.firstArrival.has(turnId)) this.firstArrival.set(turnId, this.now());
    const was = this.speaking;
    this.queue.push({ turnId, text });
    this.next();
    if (!was) this.opts.onChange(true);
  }

  stop(): void {
    this.generation += 1;
    this.muted = true;
    this.missed = [];
    const was = this.speaking;
    this.queue = [];
    this.current = undefined;
    this.tts.cancel();
    if (was) this.opts.onChange(false);
  }

  unmute(): void {
    this.muted = false;
    this.missed = [];
  }

  /** Unmutes and speaks what arrived while muted. */
  replay(): void {
    const missed = this.missed;
    this.unmute();
    for (const { turnId, text } of missed) this.enqueue(turnId, text);
  }

  private next(): void {
    if (this.current) return;
    const item = this.queue.shift();
    if (!item) return;
    this.current = item;
    const generation = this.generation;
    this.tts.speak(item.text, {
      onStart: () => {
        if (generation !== this.generation || this.started.has(item.turnId)) return;
        this.started.add(item.turnId);
        const at = this.now();
        this.opts.onTtsStarted(item.turnId, at, at - (this.firstArrival.get(item.turnId) ?? at));
      },
      onEnd: () => {
        if (generation !== this.generation || this.current !== item) return;
        this.current = undefined;
        this.next();
        if (!this.speaking) this.opts.onChange(false);
      },
    });
  }
}
