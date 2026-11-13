import { Endpointer } from "./endpointer";
import type { SpeechToText, SttHandlers } from "./types";
import type { Vad } from "./vad";
import { SILENCE_MS, type Timers } from "./web-speech";

/** Times Chrome may end its session mid-utterance before we give up and send what we have. */
const MAX_RESTARTS = 3;

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
  /** Marks the live utterance as ended by the caller (tap to send). */
  let tap = () => {};
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
      /** Words from earlier recogniser sessions in this utterance (Chrome restarted mid-way). */
      let prefix = "";
      let lastText = "";
      let restarts = 0;
      const full = (text: string) => (prefix ? `${prefix} ${text}` : text).trim();
      const recognizerHandlers = (): SttHandlers => ({
        onSpeechStart: () => {
          if (wordTiming) h.onSpeechStart();
        },
        onInterim: (text) => {
          // Words revised after we sent the turn would look pending, and never be sent.
          if (finished) return;
          lastText = full(text);
          h.onInterim(lastText);
          endpointer.transcript(lastText);
          if (wordTiming) endpointer.speechEnd();
        },
        // The recogniser only finalizes when its session ends: a tap, or Chrome stopping.
        onFinal: (text) => {
          lastText = full(text);
          endpointer.transcript(lastText);
          if (tapped) endpointer.flush();
        },
        onError: (error) => {
          finished = true;
          o.vad.stop();
          h.onError(error);
        },
        onEnd: () => {
          if (!finished && !tapped && endpointer.heard && restarts < MAX_RESTARTS) {
            // Chrome ended the session by itself mid-utterance. Sending now would cut the caller
            // off, so keep listening and let the endpointer decide when they're done.
            restarts += 1;
            prefix = lastText;
            o.recognizer.start(recognizerHandlers());
            return;
          }
          endpointer.flush();
          o.vad.stop();
          h.onEnd();
        },
      });
      let tapped = false;
      tap = () => (tapped = true);
      o.recognizer.start(recognizerHandlers());
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
      tap();
      o.vad.stop();
      o.recognizer.stop();
    },
  };
}
