# Endpointing: knowing when the caller has finished (learning guide)

**Endpointing** is deciding that the caller has finished their turn, so the agent can answer. Get it wrong one way and you cut people off mid-sentence ("a table for… [agent starts talking]"). Get it wrong the other way and every reply starts with an awkward silence. Every voice agent has to solve this, and it's one of the first things people in the field ask about.

This change replaces "1.5 s without new words" with three signals:

1. **Silero VAD** (voice activity detection) hears whether the caller is actually making speech sounds. It's a ~2 MB neural model that runs in the browser.
2. **The words** say how long to wait: "yes" can be answered almost at once, while "a table for" clearly isn't finished.
3. **The caller's own habits**: someone who often pauses for a second mid-sentence gets a longer wait.

It's still push-to-talk in this PR. Hands-free comes next and builds on this.

## 1. Reading order

| #   | File                                   | What it does                                                                                                |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | `apps/web/src/voice/turn-text.ts`      | `turnCompleteness(text)`: `complete`, `incomplete` or `neutral`, from small rules about restaurant phrases. |
| 2   | `apps/web/src/voice/endpointer.ts`     | The state machine: VAD and transcript events in, one `onEndOfTurn` out. All the timing lives here.          |
| 3   | `apps/web/src/voice/vad.ts`            | A thin adapter over `@ricky0123/vad-web` (Silero v5 on onnxruntime-web, loaded only when voice starts).     |
| 4   | `apps/web/src/voice/endpointed-stt.ts` | A `SpeechToText` that combines Web Speech (the words), the VAD and the endpointer.                          |
| 5   | `apps/web/src/voice/providers.ts`      | Uses the endpointed STT when the browser has AudioWorklet, otherwise the old 1.5 s timer.                   |
| 6   | `apps/web/scripts/copy-vad-assets.mjs` | Copies the model, the audio worklet and the WASM runtime into `public/vad/`, so we serve them ourselves.    |
| 7   | `apps/web/src/voice/*.test.ts`         | Behaviour with a hand-moved clock, a fake recogniser and a fake VAD.                                        |

## 2. Key concepts

- **Why gaps between words are a bad signal.** Web Speech sends words in bursts, and late: Chrome sends the audio to Google, and the words come back hundreds of ms after they were spoken. A pause in the _words_ doesn't mean a pause in the _voice_. The old 600 ms timer even fired while people were still talking, and 1.5 s made every reply feel slow.
- **VAD.** A model that looks at 32 ms frames of audio and says "speech" or "not speech". `redemptionMs: 200`: it reports the end of speech after 200 ms of non-speech, and we pass "silence began 200 ms ago" to the endpointer. `minSpeechMs: 150`: shorter blips (a click, a tap on the desk) don't count. We use `onSpeechRealStart`, which fires only after those 150 ms, so a blip never leaves the endpointer waiting for an end that never comes.
- **The silence window.** Once the VAD hears silence, the endpointer waits a window that depends on the words:

  | The words sound… | Example                                 | Wait                        |
  | ---------------- | --------------------------------------- | --------------------------- |
  | complete         | "yes", "that's right", "my name is Ana" | 300 ms                      |
  | can't tell       | "I was wondering about the menu"        | 1.6 s (adapts, up to 2.5 s) |
  | incomplete       | "a table for", "um", "my name is"       | 3 s                         |
  | (always)         | anything                                | 4 s at most                 |

  If the caller speaks again inside the window, nothing is sent. Their pause just becomes part of the sentence.

- **Transcript catch-up.** The window can end before Web Speech has delivered the last word. So we also wait until the words haven't changed for 200 ms, but never more than 600 ms past the window. In the live check, the full sentence was sent 0.4 s after the caller stopped.
- **Adaptation.** Each time the caller goes quiet and then _keeps going_, that pause length is saved (the last 20). Once there are 3, the "can't tell" window becomes their 90th-percentile pause + 100 ms, between 1.6 s and 2.5 s. Fast talkers get quick replies, and slow talkers aren't cut off.
- **Fallback.** If the VAD can't start (a blocked download, an old browser), each change in the words stands in for "speech ended", just like the old timer, but with the smarter windows. Browsers without AudioWorklet keep the original 1.5 s timer.
- **Cost of loading.** The model (2.3 MB) and onnxruntime's WASM (14.8 MB) are downloaded the first time you press Speak, not when the page loads, and the browser caches them after that.
- **Why rules and not a model for "sounds finished"?** They're instant, free, testable and explainable, and our callers say a small set of things. An audio turn model (Smart Turn) is a later PR. It hears intonation, which words can't show.

## 3. Potential holes and the tests that guard them

| What could go wrong                                        | Guarded by                                                                                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cut off during "a table for… four"                         | `endpointer.test.ts` › "unfinished text waits longest", "speech resuming cancels the window"                                                                                         |
| The last word is lost because Web Speech lags              | "waits for late words to settle", "words that arrive during the window re-pick it from speechEnd"; `endpointed-stt.test.ts` › "includes a word that arrives after the VAD's silence" |
| Waiting forever while words trickle in                     | "catch-up is bounded", "the hard cap bounds the wait even while words trickle in"                                                                                                    |
| A cough sends an empty message                             | "never emits empty text…"; "no words, only noise: no final, and onEnd still fires"                                                                                                   |
| The same sentence is sent twice (our end + Chrome's final) | "the recogniser's late final after we finished doesn't send twice"                                                                                                                   |
| Tap-to-send stops working                                  | "tap (stop) sends what was heard now"                                                                                                                                                |
| The VAD fails to load and voice breaks                     | "falls back to word timing when the VAD can't start"                                                                                                                                 |
| Interrupt sent twice on barge-in                           | Only the VAD's speech start is forwarded when the VAD runs (`endpointed-stt.ts`); covered by "forwards the VAD's speech start…"                                                      |
| A spoken "yes" bypasses the gate                           | Unchanged: the endpointer only produces `onFinal` text, which the controller sends as `user_text`.                                                                                   |

**Tuned on a real caller.** The first windows (0.7 s neutral, 2 s unfinished) still cut the user off. Their recording, run through the same Silero model, had mid-sentence pauses of about **0.8 s and 1.4 s**. So the neutral window became 1.6 s and the unfinished one 2.5 s, and adaptation can go up to 2.5 s. "Yes" still gets 300 ms. The cost is that a normal sentence waits about 1.6 s before the reply. Smart Turn (a model that hears whether your _intonation_ sounds finished) is the planned way to bring that back down without cutting anyone off.

**Still cut off in hands-free (second round).** Two more fixes:

- **Chrome ending its session by itself.** In continuous mode, Chrome sometimes ends a recognition session mid-sentence. We used to treat that as "the caller finished" and sent the half sentence. Now, if the caller has said something and _we_ didn't stop it (no tap, no end of turn), we restart recognition and keep adding to the same sentence. That's up to 3 times per utterance. The endpointer, not Chrome, decides when the turn is over.
- **More patience for unfinished sentences.** "A table for…" or "um" now waits 3 s (was 2.5 s), and the absolute limit is 4 s (was 3 s). "Yes" still goes after 300 ms.

**Live check.** I recorded a voice with `say` ("A table for… [1.2 s pause] four people on Friday at seven") and played it as Chrome's microphone. The real VAD ran on that audio, with scripted words lined up to it. Nothing was sent during the pause, and one message with the whole sentence went out 0.4 s after the speech ended. A second run taught us something: back then, a full request like "a table for four people on Friday" counted as finished, and it was sent before "at seven", at a breath pause. So only short answers ("yes", "no", "that's right") get the 300 ms window now. Full requests wait the adaptive window. Chrome's own recognition doesn't work in an automated browser, so a person with a real mic is still the final test.

## 4. Quiz

1. Why is "no new words for 1.5 s" a poor way to decide the caller has finished?
2. What does the VAD tell us that Web Speech can't?
3. The caller says "a table for", pauses 1 s, then says "four". Walk through what the endpointer does.
4. Why does "yes" get a 300 ms window but "my name is" 3 s?
5. What is transcript catch-up, and why is it bounded?
6. How does the endpointer adapt to a slow speaker, and why is there an upper bound?
7. What happens if the VAD model can't be downloaded?
8. Why use `onSpeechRealStart` instead of `onSpeechStart`?

<details>
<summary>Answers</summary>

1. Words arrive late and in bursts, so gaps in the words don't line up with gaps in the voice. A short timer fires mid-sentence, and a long one makes every reply slow.
2. When the caller is actually making speech sounds, frame by frame, from the audio itself and with no network delay.
3. VAD says silence; the text "a table for" is incomplete, so the endpointer waits 3 s. After 1 s the VAD hears speech again, so the window is cancelled and the 1 s pause is saved for adaptation. "four" arrives, the VAD hears silence, and "a table for four" can't be judged from the words, so the turn ends after the neutral window (1.6 s, or the caller's adapted window).
4. "Yes" is a whole answer, and waiting longer only adds delay. "my name is" promises more: answering after 300 ms would cut the caller off.
5. Waiting until the words have been unchanged for 200 ms after the window, so a late last word is included. It's bounded (600 ms) so a recogniser that keeps revising can't stall the reply.
6. It saves pauses that turned out to be mid-sentence and uses their 90th percentile + 100 ms as the "can't tell" window. The 2.5 s cap stops one odd pause from making every reply slow.
7. The VAD's `start` rejects, and the endpointed STT falls back to treating each change in the words as "speech ended". Voice still works, with the smarter windows.
8. `onSpeechStart` can fire for a blip that turns out to be a misfire, and then no speech end follows. The endpointer would sit waiting with its window cancelled. `onSpeechRealStart` only fires for speech that lasted `minSpeechMs`.

</details>
