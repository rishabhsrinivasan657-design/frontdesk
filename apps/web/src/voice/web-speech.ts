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

/** Speech recognition in Chrome, Edge and Safari; Firefox has none (`supported` is false). */
export function createWebSpeechStt(
  g: WebSpeechGlobals = globalThis as WebSpeechGlobals,
  now: () => number = Date.now,
): SpeechToText {
  const Impl = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  let active: Recognition | undefined;
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
      r.continuous = false;
      // End of speech: the `speechend` event if it comes first. Chrome often sends the final
      // result before it, so fall back to the last interim result (the last moment words changed).
      let speechEnd: number | undefined;
      let lastInterim: number | undefined;
      r.onspeechstart = () => h.onSpeechStart();
      r.onspeechend = () => (speechEnd = now());
      r.onresult = (event) => {
        const results = Array.from(event.results);
        const text = results.map((res) => res[0]?.transcript ?? "").join("");
        if (!results.every((res) => res.isFinal)) {
          lastInterim = now();
          h.onInterim(text.trim());
          return;
        }
        const final = text.trim();
        const end = speechEnd ?? lastInterim;
        if (final)
          h.onFinal(final, { ...(end !== undefined ? { speechEnd: end } : {}), sttFinal: now() });
      };
      r.onerror = (event) => h.onError(ERRORS[event.error] ?? "other");
      r.onend = () => {
        if (active === r) active = undefined;
        h.onEnd();
      };
      r.start();
    },
    stop() {
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
