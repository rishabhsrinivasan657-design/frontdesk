import type { SpeechToText, TextToSpeech } from "./types";
import { createEndpointedStt } from "./endpointed-stt";
import { createSileroVad } from "./vad";
import { createWebSpeechStt, createWebSpeechTts } from "./web-speech";

export interface VoiceProviders {
  stt: SpeechToText;
  tts: TextToSpeech;
}

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
  return { stt: createStt(), tts: createWebSpeechTts() };
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
