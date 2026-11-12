import { Endpointer } from "./endpointer";
import type { SpeechToText, SttHandlers } from "./types";
import type { Vad } from "./vad";
import { SILENCE_MS, type Timers } from "./web-speech";

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Speech-to-text whose end of turn is decided by our `Endpointer` (spec §5.3): Web Speech gives
 * the words, a VAD says when the caller is actually speaking, and the words decide how long a
 * silence ends the turn. Until the VAD is ready (it loads on first use), or if it can't start,
 * each change in the words stands in for "speech ended", with no window shorter than the old
 * 1.5 s timer, because a gap in the words isn't a gap in the voice.
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
      /** No VAD (yet): the words' timing stands in for it. */
      let wordTiming = true;
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
        onGiveUp: () => {
          if (finished || !live()) return;
          finished = true;
          o.vad.stop();
          o.recognizer.stop();
        },
      });
      endpointer.minWindowMs = SILENCE_MS;
      o.recognizer.start({
        onSpeechStart: () => {
          if (wordTiming) h.onSpeechStart();
        },
        onInterim: (text) => {
          // Words revised after we sent the turn would look pending, and never be sent.
          if (finished) return;
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
        .then(
          () => {
            if (!live() || finished) return;
            wordTiming = false;
            endpointer.minWindowMs = 0;
            // Words heard while the VAD was loading: it never heard them end, so start the clock.
            if (endpointer.heard) endpointer.speechEnd();
          },
          () => {
            // Stay on word timing.
          },
        );
    },
    stop() {
      o.vad.stop();
      o.recognizer.stop();
    },
  };
}
