import type { SpeechToText, TextToSpeech } from "./types";
import { createElevenLabsTts } from "./elevenlabs-tts";
import { createEndpointedStt } from "./endpointed-stt";
import { createConversationTts, createKokoroTts, createSwitchingTts } from "./kokoro-tts";
import { createSileroVad } from "./vad";
import { createWebSpeechStt, createWebSpeechTts } from "./web-speech";

export interface VoiceProviders {
  stt: SpeechToText;
  tts: TextToSpeech;
  /** The caller started using voice: start loading heavier models (Kokoro). */
  warmUp?: () => void;
  /** A new conversation starts: the voice is picked again at its first reply. */
  newConversation?: () => void;
}

/** Set once someone has used voice here, so their next visit preloads Kokoro from the cache. */
const VOICE_USED_KEY = "frontdesk.voiceUsed";

declare global {
  interface Window {
    /** e2e only: Playwright installs mocks here (spec §13). */
    __frontdeskVoice?: VoiceProviders;
  }
}

/**
 * The voice providers for this page: Web Speech today; Deepgram or an in-browser model later.
 * Only a build with NEXT_PUBLIC_VOICE_TEST_HOOK=1 (the e2e build) looks at the test hook.
 */
export function createVoiceProviders(): VoiceProviders {
  if (process.env.NEXT_PUBLIC_VOICE_TEST_HOOK === "1" && window.__frontdeskVoice) {
    return window.__frontdeskVoice;
  }
  const choice = new URLSearchParams(window.location.search).get("voice");
  const browserVoice = createWebSpeechTts();
  if (choice === "browser") return { stt: createStt(), tts: browserVoice };
  // Kokoro loads at the first mic press (or on page load for a returning voice user).
  // `?voice=af_bella` (any Kokoro voice id) picks Kokoro's voice, to compare; default af_heart.
  const kokoroVoice = choice && /^[a-z]{2}_[a-z]+$/.test(choice) ? choice : undefined;
  const kokoro = createKokoroTts(
    // A static module worker (public/kokoro/worker.mjs), so the model runtime loads natively.
    () => new Worker("/kokoro/worker.mjs", { type: "module" }),
    kokoroVoice,
  );
  // Fallback chain: Kokoro → ElevenLabs (while Kokoro loads, or where it can't run; off without
  // a key, and capped below the free plan) → the browser's own voice.
  const premium = createSwitchingTts(createElevenLabsTts(browserVoice), browserVoice);
  if (!kokoro.supported) return { stt: createStt(), tts: premium };
  const warmUp = () => {
    try {
      localStorage.setItem(VOICE_USED_KEY, "1");
    } catch {
      // Storage blocked: Kokoro just loads at the first press next time too.
    }
    void kokoro.load().catch((e: unknown) => console.warn("kokoro unavailable", e));
  };
  // A returning voice user: Kokoro is in the browser cache, so loading it now is cheap and the
  // first reply can already use it.
  try {
    if (localStorage.getItem(VOICE_USED_KEY)) warmUp();
  } catch {
    // Storage blocked.
  }
  if (choice === "elevenlabs") {
    // ElevenLabs first, for comparison.
    const natural = createSwitchingTts(kokoro, premium);
    return {
      stt: createStt(),
      tts: createSwitchingTts(createElevenLabsTts(natural), natural),
      warmUp,
    };
  }
  // One voice per conversation (no switching mid-call when Kokoro finishes downloading).
  const tts = createConversationTts(kokoro, premium);
  return {
    stt: createStt(),
    tts,
    warmUp,
    newConversation: () => tts.newConversation(),
  };
}

/**
 * Web Speech for the words, with our VAD endpointer deciding when the caller has finished
 * (spec §5.3). Browsers without AudioWorklet keep Web Speech's own silence timer.
 */
function createStt(): SpeechToText {
  if (typeof AudioWorkletNode === "undefined") return createWebSpeechStt();
  const recognizer = createWebSpeechStt(undefined, undefined, undefined, { silenceMs: null });
  if (!recognizer.supported) return createWebSpeechStt();
  return createEndpointedStt({ recognizer, vad: createSileroVad() });
}
