# M7: Browser voice (learning guide)

M7 lets a caller book a table by talking. The `/talk` page gets a **Speak** button. You press it and say one sentence, and you see your words appear as you speak. When you stop, the sentence is sent exactly as if you'd typed it. The agent's reply is read aloud sentence by sentence. If you press **Speak** while the agent is talking (or still thinking), it stops at once: that's barge-in. Everything uses the browser's free Web Speech API, so there are no keys and no cost. To try it, run the M6 keyless setup (`pnpm infra:up`, then the `LLM_PROVIDER=scripted … pnpm api` line from `m6-chat.md`, and `pnpm web`), open http://localhost:3000/talk in Chrome, press **Speak** and say "A table for 4 on 2026-11-07 at 19:00".

## 1. Reading order

| #   | File                                                                   | What it's for                                                                                                 |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/web/src/voice/types.ts`                                          | The two interfaces the page relies on: `SpeechToText` (mic → text) and `TextToSpeech` (text → sound).         |
| 2   | `apps/web/src/voice/web-speech.ts`                                     | The Web Speech implementations: `SpeechRecognition` (Chrome/Edge/Safari) and `speechSynthesis`.               |
| 3   | `apps/web/src/voice/speaker.ts`                                        | A queue that speaks one sentence at a time as sentences arrive. `stop()` is barge-in.                         |
| 4   | `apps/web/src/voice/controller.ts`                                     | The push-to-talk logic: the mic button, barge-in, fallbacks, and sending the final transcript as caller text. |
| 5   | `apps/web/src/voice/use-voice.ts` + `providers.ts`                     | Connects the controller to the chat socket in React. `providers.ts` picks Web Speech, or the e2e mock.        |
| 6   | `apps/web/src/components/chat/mic-button.tsx`, `chat-window.tsx`       | The Speak button, the live interim line, the fallback messages, and the voice numbers in the latency readout. |
| 7   | `packages/core/src/agent/loop.ts` (`TurnInterrupted`, `checkpoint`)    | How a turn can be cancelled, and the places where it never can be.                                            |
| 8   | `apps/api/src/chat/connection.ts`                                      | `interrupt` cancels the turn in flight; `tts_started` becomes `tts_start_ms` in Postgres.                     |
| 9   | `apps/web/src/voice/*.test.ts`, `apps/api/src/chat/connection.test.ts` | The behaviour, in unit tests with fake speech.                                                                |
| 10  | `e2e/voice-mock.ts` + `e2e/voice.spec.ts`                              | Playwright books by voice, barges in, and checks both fallbacks, with speech mocked at the interfaces.        |

## 2. Key concepts

- **Web Speech API.** Speech recognition and speech synthesis built into the browser. Chrome sends your audio to Google's servers to recognise it. That's free, but it means voice only works online and only in some browsers. Firefox has no recognition at all.
- **Interim vs final transcript.** While you speak, the recogniser keeps guessing ("a table", then "a table for"). Those are _interim_ results: we only display them. When you stop, it sends one _final_ result, and only that is sent to the agent. `stt_ms` is the time from the end of your speech to that final result. Chrome often sends the final result before its `speechend` event, so the end of speech is then taken from the last interim result: the last moment the words changed.
- **Streaming TTS by sentence.** We don't wait for the whole reply. Each `agent_sentence` is queued and spoken as soon as the previous one finishes. When the first sentence of a turn starts playing, the browser sends `tts_started` and the server stores `tts_start_ms`. The server measures it with its own clock: from sending the sentence to hearing back that it's playing.
- **Barge-in.** Real callers talk over the receptionist. When you press Speak during a reply, the speaker goes silent, drops the queued sentences, and stays muted until your next message. The browser also sends `interrupt`. If the server is still working on the turn, it cancels it at the next safe point and replies `interrupted`. Nothing from that turn is saved. Sometimes the server can't cancel: a "yes" was already being executed, or the read-back had already gone out. Then the browser plays the reply you missed, and does **not** send what you said over it. You said it before hearing the reply, so it mustn't be taken as an answer to it. A note asks you to listen and press Speak again.
- **Interfaces for swappable providers.** The page only knows `SpeechToText` and `TextToSpeech`. Deepgram (better accuracy) or an in-browser Whisper/Kokoro (works offline) can be added later as new implementations, without touching the controller or the UI.
- **Mocking in e2e.** Playwright's Chromium has no microphone, and real speech isn't repeatable. So `e2e/voice-mock.ts` installs fake implementations of the two interfaces on `window.__frontdeskVoice` before the page loads. The page only looks there in a build made with `NEXT_PUBLIC_VOICE_TEST_HOOK=1`, which is set only for e2e. A test then "speaks" by calling `__voiceTest.hear()` and `finish()`.
- **Voice can't confirm by itself.** The controller can send exactly two things: caller text and `interrupt`. A spoken "yes" is the text "yes" and goes through the same classifier as a typed one. `interrupt` never confirms anything, and never cancels an action that's already being executed.

## 3. Potential holes and the tests that guard them

| What could go wrong                                                                                 | Guarded by                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A spoken "yes" with nothing pending books something                                                 | `e2e/voice.spec.ts` › "a spoken yes with nothing pending runs a normal turn"; `controller.test.ts` › "a spoken yes is only ever caller text"                                                                                                             |
| An interrupt cancels a booking halfway (calendar written, caller never told)                        | `loop.test.ts` › "an abort during a confirm turn still executes once"; `connection.test.ts` › "interrupt during a confirm turn still reports executed"                                                                                                   |
| A read-back the caller never heard stays confirmable after an interrupt                             | `loop.test.ts` › "an abort after propose voids this turn's proposal"                                                                                                                                                                                     |
| An interrupt voids an older read-back the caller did hear                                           | `loop.test.ts` › "an already-aborted signal never touches an earlier turn's pending action"                                                                                                                                                              |
| Your next sentence is dropped as `busy` while the old turn unwinds                                  | `connection.test.ts` › "user_text after interrupt waits…"; `controller.test.ts` › "holds a final transcript until the chat is idle…"                                                                                                                     |
| The rest of an interrupted reply keeps talking                                                      | `speaker.test.ts` › "stop cancels, drops the queue and mutes…"; `e2e` › "barge-in stops speech and sends interrupt"                                                                                                                                      |
| Barge-in too late to cancel: your earlier "yes" gets classified against a read-back you never heard | `loop.test.ts` › "an abort during a lone propose voids it before the read-back is sent"; `controller.test.ts` › "a turn that couldn't be cancelled is spoken, and the held transcript is dropped", "speech still going when an uncancellable turn ends…" |
| A booking made during barge-in is shown but never spoken                                            | `controller.test.ts` › "a turn that couldn't be cancelled is spoken…"; `speaker.test.ts` › "replay speaks what arrived while muted…"                                                                                                                     |
| A held transcript is sent turns later (after a reconnect or typing)                                 | `controller.test.ts` › "typing or a dropped socket forgets a held transcript"                                                                                                                                                                            |
| An interrupt voids a new proposal that had replaced (superseded) an older one                       | **Accepted.** Nothing is left to confirm, so the caller has to ask again. That's safe: nothing unheard can be confirmed.                                                                                                                                 |
| A forged `tts_started` writes to another conversation's turn                                        | `connection.test.ts` › "ignores tts_started for a turn this socket didn't run, and repeats"                                                                                                                                                              |
| `tts_started` arrives before or after the turn row is written                                       | `connection.test.ts` › "stores tts_start_ms from tts_started, before or after the row is stored"                                                                                                                                                         |
| Firefox users, or a blocked mic, see a dead button                                                  | `e2e` › "falls back to typing when recognition is unsupported", "explains a blocked microphone…"                                                                                                                                                         |
| The mock hook works in production                                                                   | Only compiled in with `NEXT_PUBLIC_VOICE_TEST_HOOK=1` (`providers.ts`). Not tested: a production build simply never sets it.                                                                                                                             |
| An interrupted turn still pays for its Gemini call                                                  | **Known hole.** The LLM interface has no abort signal yet, so the request finishes and its output is thrown away.                                                                                                                                        |
| `tts_start_ms` includes the network round trip                                                      | **By design.** Using one clock avoids skew between the browser's and the server's clocks. On localhost the round trip is about 0.                                                                                                                        |

## 4. Quiz

1. What's the difference between an interim and a final transcript, and which one reaches the agent?
2. Why does the Speak button send the transcript as `user_text`, rather than a special voice message?
3. What exactly happens, in order, when you press Speak while the agent is reading a reply aloud?
4. The server receives `interrupt` while it's executing a booking you just confirmed. What happens, and why?
5. Why does an interrupted turn void a proposal made in that turn but not one made earlier?
6. Why does `Speaker.stop()` keep the speaker muted until your next message?
7. How is `stt_ms` measured, and why is it safe to subtract two browser timestamps?
8. Why is `tts_start_ms` measured on the server's clock instead of from the browser's `at`?
9. What does Firefox show, and why does typing still work?
10. How does Playwright "speak" to the page, and why is the mock hook harmless in production?
11. Why is the mic only open after you press the button (push-to-talk) instead of always listening?

<details>
<summary>Answers</summary>

1. Interim results are the recogniser's running guesses while you talk, and we only display them. The final result comes once you stop, and only that is sent.
2. So voice has no power that typing doesn't. The gate and classifier treat it exactly like typed text, and a spoken "yes" can only confirm a read-back that's actually waiting.
3. The speaker cancels the current sentence, drops the queue and mutes. If the agent is speaking or still thinking, the browser sends `interrupt`. Then the mic starts listening.
4. Nothing changes: core never checks the signal while a confirmed action is being executed. The booking completes once and you're told the result. Cancelling halfway could leave a calendar event you were never told about.
5. You never heard a proposal made in the interrupted turn, so a later "yes" mustn't confirm it. An earlier read-back you did hear stays valid until it expires.
6. Sentences of the cancelled turn can still arrive (for example, a turn that couldn't be cancelled). Unmuting only when you send again means none of them are spoken over you.
7. `sttFinal − speechEnd`, both from `Date.now()` in the same browser. Both come from the same clock, so the difference is meaningful even if that clock is wrong.
8. The browser's clock and the server's can be seconds apart. The server notes when it sent the first sentence and when `tts_started` arrived, both on its own clock. The cost is one network round trip.
9. "Voice isn't available in this browser…", and the Speak button is disabled. Voice only adds a way to produce text, and the chat underneath is unchanged.
10. An init script installs fake `SpeechToText`/`TextToSpeech` on `window.__frontdeskVoice`, and the test calls `__voiceTest.hear()`/`finish()`. Only a build with `NEXT_PUBLIC_VOICE_TEST_HOOK=1` reads that hook.
11. An always-open mic would hear the agent's own voice through the speakers and barge in on itself. Push-to-talk also makes it clear when you're being heard.

</details>
