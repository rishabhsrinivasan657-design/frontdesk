# Hands-free conversation and natural barge-in (learning guide)

Push-to-talk means tapping before every sentence. Real phone calls don't work like that. With **Hands-free**, you tap once and then just talk. When the receptionist has finished replying, the mic opens again by itself. If you talk over it, it **fades its voice down at once**, and only stops for good if you keep talking. A cough or an "mm-hm" doesn't cut it off. After 30 s with nothing said, hands-free switches itself off and frees the mic.

## 1. Reading order

| #   | File                                    | What it does                                                                                                 |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | `apps/web/src/voice/hands-free.ts`      | `HandsFree`: decides when to listen again, watches for barge-in, ducks, commits, and switches off when idle. |
| 2   | `apps/web/src/voice/speaker.ts`         | `duck(on)`: fades the agent to 25% volume, or back up.                                                       |
| 3   | `apps/web/src/voice/kokoro-tts.ts`      | `setVolume`: a gain node, ramped over ~50 ms so the fade doesn't click.                                      |
| 4   | `apps/web/src/voice/use-voice.ts`       | Wires it up; exposes `handsFree`, `toggleHandsFree()` and `agentSpeaking` for the page (and the orb).        |
| 5   | `apps/web/src/components/talk/orb.tsx`  | The "Hands-free" / "End conversation" button.                                                                |
| 6   | `apps/web/src/voice/hands-free.test.ts` | The behaviour, with a fake recogniser, a fake VAD and a hand-moved clock.                                    |

## 2. Key concepts

- **Built on the existing controller.** `HandsFree` doesn't send anything itself. It only decides _when_ to call the controller's `press()`, which already handles barge-in safely: stop speech, send `interrupt`, and drop a sentence that was said over a reply which couldn't be cancelled. So a spoken "yes" still only reaches the agent as caller text, through the same confirmation gate as typing.
- **When to listen again.** Only when nothing is pending: the caller's text was sent _and_ its turn ended (`turn_metrics`, `interrupted` or `error`), the agent has finished speaking, and the chat isn't busy. We track "waiting for the reply" ourselves, because the chat only shows busy a moment after sending. Without that, the mic reopened in the gap.
- **Barge-in in two steps.** While the agent thinks or speaks, a second Silero VAD listens on the echo-cancelled mic.
  1. **Duck:** as soon as it hears real speech (150 ms), the agent fades to 25% volume, so the caller can hear themselves and the agent sounds like it's yielding.
  2. **Commit:** if the speech lasts another 250 ms, it's a barge-in. If it stops sooner (a cough, "mm-hm"), the volume comes back and the reply carries on.
- **Echo.** Kokoro plays through the page's own audio, which the browser's echo cancellation can subtract from the mic, so the agent doesn't barge in on itself. The browser voice (`speechSynthesis`) can't be ducked or reliably cancelled, so with it, use headphones or tap to interrupt.
- **Re-entrancy.** Stopping the agent's speech fires "speech changed", which asks hands-free what to do next, _while_ it's already in the middle of pressing the mic. That started two recognisers at once (found in the live Chrome check). Now calls into the controller are marked `acting`, and hands-free catches up once after they return.

## 3. Checked

- Unit tests: listens again after the reply; ducks, then barges in after 250 ms; a short sound only ducks; barging in while the agent is thinking sends `interrupt`; switches off after 30 s of silence; one recogniser per barge-in.
- Live, in Chrome with a recorded voice as the mic, the real VAD and the scripted agent: five turns in a row, each one sent, answered, spoken, and the mic reopened by itself.

## 4. Quiz

1. Why does `HandsFree` call the controller's `press()` instead of sending things itself?
2. Why track "waiting for the reply" instead of just checking whether the chat is busy?
3. What are the two steps of barge-in, and why not stop the agent at the first sound?
4. Why does Kokoro make hands-free barge-in work better than the browser voice?
5. What went wrong before the `acting` flag, and how did we find it?

<details>
<summary>Answers</summary>

1. The controller already handles barge-in safely, including dropping speech said over a reply that couldn't be cancelled. Going through it keeps one path, and voice can still only send caller text and `interrupt`.
2. The chat state updates a moment after sending. In that gap the chat looked idle, and hands-free reopened the mic before the reply had even arrived.
3. Duck (fade to 25% on the first 150 ms of speech), then commit (barge in only if speech lasts another 250 ms). Stopping at the first sound would let every cough or "mm-hm" cut the agent off.
4. Its audio plays through the page, so echo cancellation can remove it from the mic, and its volume can be faded. The browser voice plays through the operating system: it can't be faded, and the mic may hear it.
5. Stopping the speech triggered a re-check that pressed the mic again from inside the first press, so two recognisers started. A live Chrome run showed two "start" lines at the same moment.

</details>
