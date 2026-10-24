import type { SpeechToText, SttError, TextToSpeech } from "./types";

/** The bits of SpeechRecognition we use (TypeScript's DOM types don't include it). */
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface RecognitionEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

interface Utterance {
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

/** Where the Web Speech API lives (`globalThis` in a browser); tests pass fakes. */
export interface WebSpeechGlobals {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
  speechSynthesis?: { speak(u: Utterance): void; cancel(): void };
  SpeechSynthesisUtterance?: new (text: string) => Utterance;
}

const ERRORS: Record<string, SttError> = {
  "not-allowed": "not-allowed",
  "service-not-allowed": "not-allowed",
  "no-speech": "no-speech",
  network: "network",
  aborted: "aborted",
};

/**
 * How long without new words before we call the utterance finished (endpointing). With
 * `continuous = false` Chrome decides this itself, and waits about 1.6–1.9 s: far over the spec §8
 * STT budget (p50 400 ms, p95 800 ms). So we listen continuously and end the utterance ourselves.
 * The trade-off: shorter cuts people off when they pause mid-sentence ("a table for… four"),
 * longer misses the budget. `stt_ms` is measured from the last change in words, so it is at least
 * this long.
 */
export const SILENCE_MS = 600;

/** `setTimeout`/`clearTimeout`, injectable so tests can move time by hand. */
export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Speech recognition in Chrome, Edge and Safari; Firefox has none (`supported` is false). */
export function createWebSpeechStt(
  g: WebSpeechGlobals = globalThis as WebSpeechGlobals,
  now: () => number = Date.now,
  timers: Timers = realTimers,
): SpeechToText {
  const Impl = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  let active: Recognition | undefined;
  let cancelSilence = () => {};
  return {
    supported: Impl !== undefined,
    start(h) {
      if (!Impl) {
        h.onError("other");
        return;
      }
      const r = new Impl();
      active = r;
      r.lang = "en-US";
      r.interimResults = true;
      r.continuous = true;
      // End of speech: the `speechend` event if it comes first. Chrome often sends the final
      // result before it, so fall back to the last interim result (the last moment words changed).
      let speechEnd: number | undefined;
      let lastInterim: number | undefined;
      let lastText = "";
      // One utterance, one `onFinal`: whichever of our silence timer or Chrome's final comes first.
      let done = false;
      let silence: unknown;
      const clearSilence = () => {
        if (silence !== undefined) timers.clear(silence);
        silence = undefined;
      };
      cancelSilence = clearSilence;
      const finish = (text: string, end: number | undefined) => {
        clearSilence();
        if (done) return;
        done = true;
        if (text)
          h.onFinal(text, { ...(end !== undefined ? { speechEnd: end } : {}), sttFinal: now() });
      };
      r.onspeechstart = () => h.onSpeechStart();
      r.onspeechend = () => (speechEnd = now());
      r.onresult = (event) => {
        if (done) return;
        const results = Array.from(event.results);
        const text = results
          .map((res) => res[0]?.transcript ?? "")
          .join("")
          .trim();
        if (results.every((res) => res.isFinal)) {
          finish(text, speechEnd ?? lastInterim);
          return;
        }
        if (text === lastText) return;
        lastText = text;
        lastInterim = now();
        h.onInterim(text);
        clearSilence();
        silence = timers.set(() => {
          silence = undefined;
          finish(lastText, lastInterim);
          r.stop();
        }, SILENCE_MS);
      };
      r.onerror = (event) => {
        clearSilence();
        h.onError(ERRORS[event.error] ?? "other");
      };
      r.onend = () => {
        clearSilence();
        if (active === r) active = undefined;
        h.onEnd();
      };
      r.start();
    },
    stop() {
      cancelSilence();
      active?.stop();
    },
  };
}

/** Speech synthesis with the browser's own voices. */
export function createWebSpeechTts(
  g: WebSpeechGlobals = globalThis as WebSpeechGlobals,
): TextToSpeech {
  const synth = g.speechSynthesis;
  const Utter = g.SpeechSynthesisUtterance;
  return {
    supported: synth !== undefined && Utter !== undefined,
    speak(text, h) {
      if (!synth || !Utter) {
        h.onEnd();
        return;
      }
      const u = new Utter(text);
      u.lang = "en-US";
      u.onstart = () => h.onStart();
      u.onend = () => h.onEnd();
      u.onerror = () => h.onEnd();
      synth.speak(u);
    },
    cancel() {
      synth?.cancel();
    },
  };
}
