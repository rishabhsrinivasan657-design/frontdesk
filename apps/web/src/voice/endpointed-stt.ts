import { Endpointer } from "./endpointer";
import type { SpeechToText, SttHandlers } from "./types";
import type { Vad } from "./vad";
import type { Timers } from "./web-speech";

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Speech-to-text whose end of turn is decided by our `Endpointer` (spec §5.3): Web Speech gives
 * the words, a VAD says when the caller is actually speaking, and the words decide how long a
 * silence ends the turn. If the VAD can't start (no model, old browser), each change in the words
 * stands in for "speech ended", like the old timer but with the smarter windows.
 * `recognizer` must not end utterances on its own (`createWebSpeechStt(..., { silenceMs: null })`).
 */
export function createEndpointedStt(o: {
  recognizer: SpeechToText;
  vad: Vad;
  now?: () => number;
  timers?: Timers;
}): SpeechToText {
  const now = o.now ?? Date.now;
  const timers = o.timers ?? realTimers;
  let session = 0;
  return {
    supported: o.recognizer.supported,
    start(h: SttHandlers) {
      const mine = ++session;
      const live = () => mine === session;
      let finished = false;
      /** No VAD: the words' timing stands in for it. */
      let wordTiming = false;
      const endpointer = new Endpointer({
        timers,
        now,
        onEndOfTurn: (text, speechEnd) => {
          if (finished || !live()) return;
          finished = true;
          h.onFinal(text, { speechEnd, sttFinal: now() });
          o.vad.stop();
          o.recognizer.stop();
        },
      });
      o.recognizer.start({
        onSpeechStart: () => {
          if (wordTiming) h.onSpeechStart();
        },
        onInterim: (text) => {
          h.onInterim(text);
          endpointer.transcript(text);
          if (wordTiming) endpointer.speechEnd();
        },
        // The recogniser only finalizes when its session ends (a tap, or Chrome stopping).
        onFinal: (text) => {
          endpointer.transcript(text);
          endpointer.flush();
        },
        onError: (error) => {
          finished = true;
          o.vad.stop();
          h.onError(error);
        },
        onEnd: () => {
          endpointer.flush();
          o.vad.stop();
          h.onEnd();
        },
      });
      o.vad
        .start({
          onSpeechStart: () => {
            if (!live() || finished) return;
            endpointer.speechStart();
            h.onSpeechStart();
          },
          onSpeechEnd: (at) => {
            if (live() && !finished) endpointer.speechEnd(at);
          },
        })
        .catch(() => {
          if (!live() || finished) return;
          wordTiming = true;
          endpointer.speechEnd();
        });
    },
    stop() {
      o.vad.stop();
      o.recognizer.stop();
    },
  };
}
