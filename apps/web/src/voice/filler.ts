import type { Speaker } from "./speaker";
import type { Timers } from "./web-speech";

/** No reply sentence this long after the caller finished: acknowledge them. */
export const FILLER_DELAY_MS = 1200;
/** The speaker's turn id for fillers, so they're never reported as the reply's TTS start. */
export const FILLER_TURN = "filler";
const PHRASES = ["One moment.", "Let me check.", "Sure, one second.", "Okay, let me see."];

/**
 * Covers a slow first token (Gemini's free tier queues, spec §8) with a short acknowledgement,
 * the way a person says "let me check". It's spoken locally only: never sent to the agent, never
 * in the transcript, so it can't confirm or change anything.
 */
export class Filler {
  private timer: unknown;
  private next = 0;

  constructor(private readonly o: { speaker: Speaker; timers: Timers }) {}

  /** The caller's words were just sent. */
  sent(): void {
    this.cancel();
    const phrase = PHRASES[this.next++ % PHRASES.length]!;
    // Generate it now, so it plays instantly if needed (Kokoro takes ~0.6 s).
    this.o.speaker.prepare(phrase);
    this.timer = this.o.timers.set(() => {
      this.timer = undefined;
      this.o.speaker.enqueue(FILLER_TURN, phrase);
    }, FILLER_DELAY_MS);
  }

  /** The first reply sentence arrived (or the turn ended): no filler needed. */
  replied(): void {
    this.cancel();
  }

  cancel(): void {
    if (this.timer !== undefined) this.o.timers.clear(this.timer);
    this.timer = undefined;
  }
}
