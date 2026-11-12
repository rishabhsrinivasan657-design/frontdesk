import type { KokoroTts } from "./kokoro-tts";
import type { TextToSpeech } from "./types";

/**
 * ElevenLabs, for comparison only (`/talk?voice=elevenlabs`, spec §5.6). Audio comes from our own
 * `/api/voice/tts` route (the key stays on the server) and plays through the page's AudioContext,
 * so it can be ducked and echo-cancelled like Kokoro. If the route says no (off, monthly cap,
 * out of credits), `ready` turns false and the switching voice falls back to Kokoro.
 * It has KokoroTts's shape so `createSwitchingTts` can use it as the primary voice.
 */
export function createElevenLabsTts(
  /** Speaks a sentence ElevenLabs couldn't, so nothing is skipped. */
  fallback: TextToSpeech,
  fetchImpl: typeof fetch = fetch,
): KokoroTts {
  let ok = true;
  let ctx: AudioContext | undefined;
  let gain: GainNode | undefined;
  let volume = 1;
  let current: AudioBufferSourceNode | undefined;
  let generation = 0;
  const cache = new Map<string, Promise<AudioBuffer | undefined>>();

  function context(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext();
      gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
    }
    return ctx;
  }

  function audioFor(text: string): Promise<AudioBuffer | undefined> {
    let p = cache.get(text);
    if (!p) {
      p = fetchImpl("/api/voice/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      })
        .then(async (res) => {
          if (!res.ok) {
            ok = false;
            console.warn(`elevenlabs unavailable (${res.status}); using Kokoro`);
            return undefined;
          }
          return context().decodeAudioData(await res.arrayBuffer());
        })
        .catch(() => {
          ok = false;
          return undefined;
        });
      cache.set(text, p);
      if (cache.size > 20) cache.delete(cache.keys().next().value!);
    }
    return p;
  }

  return {
    supported: typeof AudioContext !== "undefined",
    get ready() {
      return ok;
    },
    load: () => Promise.resolve(),
    prepare(text) {
      if (ok) void audioFor(text);
    },
    speak(text, h) {
      const mine = generation;
      void audioFor(text).then((buffer) => {
        if (mine !== generation) return;
        if (!buffer) {
          fallback.speak(text, h);
          return;
        }
        const c = context();
        void c.resume();
        const src = c.createBufferSource();
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
      if (ctx && gain) gain.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    },
    cancel() {
      generation += 1;
      const src = current;
      current = undefined;
      src?.stop();
    },
  };
}
