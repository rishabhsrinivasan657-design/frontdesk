# Covering slow replies: "one moment" and voice-to-voice time (learning guide)

Gemini's free tier sometimes queues a request for several seconds before the first word comes back (see `llm-latency.md`). On a phone call, silence that long makes people think the line dropped. A human receptionist says "let me check". So does ours now.

## 1. Reading order

| #   | File                               | What it does                                                                                                   |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/web/src/voice/filler.ts`     | `Filler`: 1.2 s after your words are sent, if no reply sentence has arrived, says a short phrase.              |
| 2   | `apps/web/src/voice/use-voice.ts`  | Arms it on send, cancels it on the first reply sentence, the turn's end or a barge-in; measures `voiceTurnMs`. |
| 3   | `apps/web/src/voice/hands-free.ts` | The idle clock now starts when the agent goes quiet, so a long reply doesn't end hands-free.                   |

## 2. Key concepts

- **Filler.** "One moment.", "Let me check.", "Sure, one second." or "Okay, let me see.", in rotation. It's spoken **only in the browser**: never sent to the agent, never in the transcript, so it can't confirm or change anything. It's generated in advance (Kokoro's `prepare`), so it plays instantly.
- **Why 1.2 s?** Most good replies start within about 1.3 s (the median Gemini time to first token). Earlier, and the filler would play before nearly every reply. Later, and the silence already feels broken.
- **Voice-to-voice time (`voiceTurnMs`).** From the moment you stopped speaking to the moment the reply's first audio plays. That's spec §8's "voice turn total" (budget p50 1.3 s), the number callers actually feel. `useVoice` exposes it in `latency.voiceTurnMs`. It adds up end of turn (0.3–1.6 s, by design), Gemini's first token, and Kokoro's first sentence (~0.6 s).
- **Hands-free idle fix.** The 30 s "nobody's talking" clock used to count from your last words, so a long reply ended the conversation. Now it counts from when the agent goes quiet.

## 3. Quiz

1. Why is the filler spoken locally instead of being sent by the agent?
2. Why wait 1.2 s before saying it?
3. Which stages add up to voice-to-voice time, and which one do we not control?

<details>
<summary>Answers</summary>

1. So it can never become part of the conversation: the agent doesn't see it, and it can't confirm or change a booking.
2. Most replies start within about 1.3 s. Saying it sooner would put "one moment" before almost every reply.
3. End of turn, Gemini's time to first token and Kokoro's first sentence. Gemini's free-tier queueing is the one we can't control. The filler covers it.

</details>
