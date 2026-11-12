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

/** The bits of SpeechSynthesisVoice we look at. */
export interface VoiceInfo {
  name: string;
  lang: string;
}

interface Utterance {
  lang: string;
  voice?: unknown;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

/** Where the Web Speech API lives (`globalThis` in a browser); tests pass fakes. */
export interface WebSpeechGlobals {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
  speechSynthesis?: { speak(u: Utterance): void; cancel(): void; getVoices?(): VoiceInfo[] };
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
 * `continuous = false` Chrome ends the turn itself at the first pause it hears, so we listen
 * continuously and end the utterance ourselves. In this mode an `isFinal` result only means one
 * phrase is settled, not that the caller is done, so it never ends the turn.
 * The trade-off: shorter cuts people off when they pause mid-sentence ("a table for… four"), and
 * interim words arrive in bursts, so 600 ms even fired while people were still talking. Longer is
 * over the spec §8 STT budget (p95 800 ms), so a caller in a hurry can tap the mic to send at once.
 * `stt_ms` is measured from the last change in words, so it is at least this long unless they tap.
 */
export const SILENCE_MS = 1500;

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
  /** `silenceMs: null`: never end the utterance on our own (an endpointer outside decides). */
  opts: { silenceMs?: number | null } = {},
): SpeechToText {
  const silenceMs = opts.silenceMs === undefined ? SILENCE_MS : opts.silenceMs;
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
      // result before it, so fall back to the last moment the words changed.
      let speechEnd: number | undefined;
      let lastChange: number | undefined;
      let lastText = "";
      // One utterance, one `onFinal`: whichever of our silence timer or the session ending is first.
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
        if (text === lastText) return;
        lastText = text;
        lastChange = now();
        h.onInterim(text);
        clearSilence();
        if (silenceMs === null) return;
        silence = timers.set(() => {
          silence = undefined;
          finish(lastText, lastChange);
          r.stop();
        }, silenceMs);
      };
      r.onerror = (event) => {
        clearSilence();
        done = true;
        h.onError(ERRORS[event.error] ?? "other");
      };
      r.onend = () => {
        // Tapping the mic, or Chrome ending the session, sends what we have.
        finish(lastText, speechEnd ?? lastChange);
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

/** Better-sounding voices first: neural ones (Edge "Natural"), Google's, then macOS Enhanced/Premium. */
const VOICE_RANKS = [/natural|neural/i, /^google us english/i, /premium/i, /enhanced/i, /^google/i];

/**
 * The best US-English voice the browser has, or undefined to keep the default. The default is
 * often an old, flat system voice, which is what made replies sound robotic.
 */
export function pickVoice<V extends VoiceInfo>(voices: V[]): V | undefined {
  const english = voices.filter((v) => v.lang.replace("_", "-").startsWith("en-US"));
  for (const rank of VOICE_RANKS) {
    const found = english.find((v) => rank.test(v.name));
    if (found) return found;
  }
  return english[0];
}

/** Speech synthesis with the best of the browser's own voices. */
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
      // Voices load asynchronously in Chrome, so pick at speak time rather than once.
      const voice = pickVoice(synth.getVoices?.() ?? []);
      if (voice) u.voice = voice;
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
