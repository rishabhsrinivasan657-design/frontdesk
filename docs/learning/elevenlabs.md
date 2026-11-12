# ElevenLabs as a comparison voice (learning guide)

ElevenLabs is the best-known paid voice provider. We use it only **for comparison**: `/talk?voice=elevenlabs`. Everyone else hears Kokoro, the free voice that runs in the browser. The free ElevenLabs plan gives roughly 20,000 characters a month on its fast model, which is about 15 short booking calls. That's plenty for showing it side by side, and far too little to make it the default.

## 1. Reading order

| #   | File                                      | What it does                                                                                                                                  |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/web/src/voice/elevenlabs-proxy.ts`  | Server side: checks the request comes from our page, the text is a sentence, and the monthly cap; calls ElevenLabs with the key.              |
| 2   | `apps/web/src/app/api/voice/tts/route.ts` | The Next.js route around it: `POST /api/voice/tts { text }` → audio.                                                                          |
| 3   | `apps/web/src/voice/elevenlabs-tts.ts`    | Browser side: fetches the audio, plays it through the page's AudioContext (so it can be ducked and echo-cancelled), and falls back to Kokoro. |
| 4   | `apps/web/src/voice/providers.ts`         | `?voice=elevenlabs` puts it in front of Kokoro.                                                                                               |

## 2. Key concepts

- **The key stays on the server.** The browser never sees `ELEVENLABS_API_KEY`. It asks our own `/api/voice/tts` route (same site, so no cross-site request), and the route calls ElevenLabs.
- **$0 by construction.** The free plan has no card on file, so it can't be charged. On top of that, our route stops at 18,000 characters a month, below the free allowance. When ElevenLabs says no (off, cap reached, out of credits), the voice switches to Kokoro, including for the sentence that failed. Nothing is ever skipped.
- **Only our page can use it.** The route checks that the request's `Origin` is our own site, and that the text is at most 400 characters, so it can't be used as a free text-to-speech service for anything else.
- **Flash v2.5.** ElevenLabs' lowest-latency model, at half the credits per character.
- **The voice.** "Sarah" by default, a premade voice every account has. `ELEVENLABS_VOICE_ID` picks another.
- **Known limit.** The monthly count lives in the web server's memory, so a restart forgets it. The plan's own limit still holds, and then we fall back to Kokoro.

## 3. Setup

1. Create a free account at elevenlabs.io and copy an API key.
2. Locally: put `ELEVENLABS_API_KEY=…` in `apps/web/.env.local`. It's git-ignored, and it must never be committed.
3. On Render: on the **casa-fiorella** (web) service → Environment, add `ELEVENLABS_API_KEY`.

## 4. Quiz

1. Why does the browser call our own route instead of ElevenLabs directly?
2. Why can this never cost money?
3. What happens to a sentence if ElevenLabs refuses it?
4. Why play ElevenLabs audio through an AudioContext instead of an `<audio>` element?

<details>
<summary>Answers</summary>

1. Calling ElevenLabs directly would put the API key in the page, where anyone could copy it.
2. The free plan has no card, and our route also stops below the free allowance.
3. The same sentence is spoken by Kokoro instead, and later sentences go straight to Kokoro.
4. So it shares Kokoro's gain node path: it can be ducked during barge-in, and the browser's echo cancellation can subtract it.

</details>
