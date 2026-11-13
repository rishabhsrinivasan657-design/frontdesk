import type { TextToSpeech } from "./types";

type FromWorker =
  | { type: "ready"; device: string }
  | { type: "audio"; id: number; audio: Float32Array; rate: number }
  | { type: "error"; id?: number; message: string };

export interface KokoroTts extends TextToSpeech {
  /** Starts downloading the model (~90 MB the first time, then cached). Resolves when it can speak. */
  load(): Promise<void>;
  readonly ready: boolean;
}

/**
 * Kokoro, a neural voice that runs in the browser (spec §5.6). Audio plays through the page's own
 * AudioContext, which (unlike `speechSynthesis`) the browser's echo cancellation can subtract,
 * which hands-free barge-in will need. Sentences are generated ahead with `prepare`, so the next
 * one is usually ready when the current one ends.
 */
export function createKokoroTts(makeWorker: () => Worker, voice?: string): KokoroTts {
  let worker: Worker | undefined;
  let loading: Promise<void> | undefined;
  let ready = false;
  let ctx: AudioContext | undefined;
  let nextId = 1;
  const waiting = new Map<number, (a: { audio: Float32Array; rate: number } | undefined) => void>();
  /** Generated (or generating) audio by text, so `prepare` and `speak` share the work. */
  const cache = new Map<string, Promise<{ audio: Float32Array; rate: number } | undefined>>();
  let current: AudioBufferSourceNode | undefined;
  /** All Kokoro audio goes through this, so ducking is one gain change. */
  let gain: GainNode | undefined;
  let volume = 1;
  let generation = 0;

  function ensureWorker(): Worker {
    if (worker) return worker;
    worker = makeWorker();
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === "audio") {
        waiting.get(m.id)?.({ audio: m.audio, rate: m.rate });
        waiting.delete(m.id);
      } else if (m.type === "error" && m.id !== undefined) {
        waiting.get(m.id)?.(undefined);
        waiting.delete(m.id);
      }
    };
    return worker;
  }

  function audioFor(text: string) {
    let p = cache.get(text);
    if (!p) {
      const id = nextId++;
      p = new Promise((resolve) => waiting.set(id, resolve));
      ensureWorker().postMessage({ type: "say", id, text, voice });
      cache.set(text, p);
      // Keep the cache small: replies rarely repeat.
      if (cache.size > 20) cache.delete(cache.keys().next().value!);
    }
    return p;
  }

  return {
    supported: typeof Worker !== "undefined" && typeof AudioContext !== "undefined",
    get ready() {
      return ready;
    },
    load() {
      loading ??= new Promise<void>((resolve, reject) => {
        const w = ensureWorker();
        const onReady = (e: MessageEvent<FromWorker>) => {
          if (e.data.type === "ready") {
            ready = true;
            console.info(`kokoro ready (${e.data.device})`);
            resolve();
          } else if (e.data.type === "error" && e.data.id === undefined) {
            reject(new Error(e.data.message));
          } else return;
          w.removeEventListener("message", onReady);
        };
        w.addEventListener("message", onReady);
        w.postMessage({ type: "load", voice });
      });
      return loading;
    },
    prepare(text) {
      if (ready) void audioFor(text);
    },
    speak(text, h) {
      const mine = generation;
      void audioFor(text).then((a) => {
        if (mine !== generation) return;
        if (!a) {
          h.onEnd();
          return;
        }
        if (!ctx) {
          ctx = new AudioContext();
          gain = ctx.createGain();
          gain.gain.value = volume;
          gain.connect(ctx.destination);
        }
        void ctx.resume();
        const buffer = ctx.createBuffer(1, a.audio.length, a.rate);
        buffer.copyToChannel(a.audio as Float32Array<ArrayBuffer>, 0);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(gain!);
        src.onended = () => {
          if (current === src) current = undefined;
          h.onEnd();
        };
        current = src;
        src.start();
        h.onStart();
      });
    },
    setVolume(v) {
      volume = v;
      // A short ramp, so ducking sounds like a fade rather than a click.
      if (ctx && gain) gain.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    },
    cancel() {
      generation += 1;
      const src = current;
      current = undefined;
      // Like speechSynthesis.cancel(): the cancelled sentence's onEnd still fires (via onended).
      src?.stop();
    },
  };
}

/**
 * Speaks with `primary` once it's ready, and with `fallback` until then (or if it never loads).
 * Decided per sentence, so a sentence never switches voice halfway.
 */
export function createSwitchingTts(primary: KokoroTts, fallback: TextToSpeech): TextToSpeech {
  const pick = () => (primary.ready ? primary : fallback);
  return {
    supported: primary.supported || fallback.supported,
    prepare: (text) => primary.prepare?.(text),
    // Only Kokoro can be ducked; speechSynthesis can't change volume mid-sentence.
    setVolume: (v) => primary.setVolume?.(v),
    speak: (text, h) => pick().speak(text, h),
    cancel() {
      primary.cancel();
      fallback.cancel();
    },
  };
}

/** How long the first reply may wait for a Kokoro that's still loading (e.g. from the cache). */
export const KOKORO_GRACE_MS = 1500;

export interface ConversationTts extends TextToSpeech {
  /** A new conversation starts: the next reply picks the voice again. */
  newConversation(): void;
}

/**
 * One voice per conversation: switching voices mid-call throws people off. The voice is picked
 * at the first reply: Kokoro if it's ready (waiting up to `graceMs` if it's still loading),
 * otherwise `fallback` (ElevenLabs, or the browser voice), and kept until `newConversation()`.
 * A Kokoro that finishes downloading mid-call is used from the next conversation.
 */
export function createConversationTts(
  kokoro: KokoroTts,
  fallback: TextToSpeech,
  graceMs = KOKORO_GRACE_MS,
): ConversationTts {
  let locked: Promise<TextToSpeech> | undefined;
  /** Bumped by cancel(), so a sentence waiting for the voice choice isn't spoken after barge-in. */
  let generation = 0;
  function voice(): Promise<TextToSpeech> {
    locked ??= kokoro.ready
      ? Promise.resolve(kokoro)
      : Promise.race([
          kokoro.load().then(
            () => (kokoro.ready ? kokoro : fallback),
            () => fallback,
          ),
          new Promise<TextToSpeech>((r) => setTimeout(() => r(fallback), graceMs)),
        ]).then((v) => {
          console.info(`voice for this conversation: ${v === kokoro ? "kokoro" : "fallback"}`);
          return v;
        });
    return locked;
  }
  return {
    supported: kokoro.supported || fallback.supported,
    prepare(text) {
      void voice().then((v) => v.prepare?.(text));
    },
    speak(text, h) {
      const mine = generation;
      void voice().then((v) => {
        if (mine === generation) v.speak(text, h);
      });
    },
    setVolume(v) {
      kokoro.setVolume?.(v);
      fallback.setVolume?.(v);
    },
    cancel() {
      generation += 1;
      kokoro.cancel();
      fallback.cancel();
    },
    newConversation() {
      locked = undefined;
    },
  };
}
