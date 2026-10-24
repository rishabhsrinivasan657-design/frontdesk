/**
 * Voice providers (spec §8). The page only talks to these two interfaces, so the browser's Web
 * Speech API can later be swapped for Deepgram or an in-browser model, and e2e tests can mock
 * them (spec §13).
 */

export type SttError = "not-allowed" | "no-speech" | "network" | "aborted" | "other";

export interface SttHandlers {
  /** The caller started speaking (the barge-in signal). */
  onSpeechStart(): void;
  /** Best guess so far; it may still change. */
  onInterim(text: string): void;
  /** The finished transcript, with browser timestamps (ms) for `stt_ms`. */
  onFinal(text: string, timings: { speechEnd?: number; sttFinal: number }): void;
  onError(error: SttError): void;
  /** Listening stopped (after a final, an error, or `stop()`). */
  onEnd(): void;
}

export interface SpeechToText {
  readonly supported: boolean;
  /** Listens for one utterance. */
  start(handlers: SttHandlers): void;
  stop(): void;
}

export interface TextToSpeech {
  readonly supported: boolean;
  /** Speaks one sentence; `onEnd` also fires if it fails, so a queue never stalls. */
  speak(text: string, handlers: { onStart(): void; onEnd(): void }): void;
  /** Stops the sentence being spoken. */
  cancel(): void;
}
