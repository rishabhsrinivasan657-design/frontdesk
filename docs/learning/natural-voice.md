# A natural voice: Kokoro in the browser (learning guide)

Replies used to be read by the browser's default voice, which on a Mac is often an old, flat system voice ("a dead man speaking"). This change does two things:

1. **The best browser voice.** It now picks the best US-English voice the browser has, instead of the default: neural "Natural" voices (Edge), then "Google US English" (Chrome), then macOS "Premium"/"Enhanced". This is free and instant.
2. **Kokoro.** An open-source neural text-to-speech model (82 million parameters, Apache-licensed) that runs **inside your browser**. It sounds close to a person, costs nothing per word and needs no server.

The browser voice speaks until Kokoro has loaded. `/talk?voice=browser` forces the browser voice, so you can compare the two.

## 1. Reading order

| #   | File                                     | What it does                                                                                                          |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/web/src/voice/web-speech.ts`       | `pickVoice`: ranks the browser's voices and picks the best US-English one at speak time.                               |
| 2   | `apps/web/public/kokoro/worker.mjs`      | A Web Worker that loads Kokoro (WebGPU if available, else WASM), warms it up, and turns a sentence into audio.         |
| 3   | `apps/web/src/voice/kokoro-tts.ts`       | `createKokoroTts`: a `TextToSpeech` that asks the worker for audio and plays it. `createSwitchingTts`: browser voice until Kokoro is ready. |
| 4   | `apps/web/src/voice/speaker.ts`          | Calls `tts.prepare(text)` as soon as a sentence is queued, so the next sentence is generated while the current one plays. |
| 5   | `apps/web/src/voice/providers.ts`        | Wires it up; `?voice=browser` skips Kokoro.                                                                            |
| 6   | `apps/web/src/voice/use-voice.ts`        | The first mic press calls `warmUp()`, which starts the Kokoro download.                                                |
| 7   | `apps/web/scripts/copy-vad-assets.mjs`   | Also copies Kokoro's self-contained browser bundle to `public/kokoro/`.                                                |

## 2. Key concepts

- **Text-to-speech (TTS).** Turning text into audio. Browser voices are old, rule-based or concatenative voices. Kokoro is a neural network that predicts the audio, which is why it has natural rhythm and intonation.
- **Web Worker.** A background thread in the browser. Generating audio takes hundreds of milliseconds of heavy math. In a worker, the page stays smooth while it runs.
- **WebGPU vs WASM.** WebGPU runs the model on your graphics chip (fast). WASM runs it on the CPU (slower, but works everywhere). The worker picks WebGPU when the browser offers it.
- **Warm-up.** The first generation on WebGPU compiles the GPU programs and took about 2.7 s in our test. The worker does that once with "Hello." right after loading, so a caller never waits for it.
- **Prefetch (`prepare`).** When a reply sentence arrives, the speaker immediately asks Kokoro to start generating it, even if another sentence is still playing. Most sentences are then ready by the time they're needed. Generated audio is also cached by text, so a repeated sentence plays instantly.
- **Why not bundle it with webpack?** Kokoro runs on transformers.js, which loads its own runtime files with dynamic `import()`s. Webpack rewrites those and breaks them. So we serve Kokoro's self-contained browser bundle as a static file (`public/kokoro/kokoro.web.js`) and run it from a plain module worker. The browser loads it natively, exactly like the VAD files.
- **Echo, for later.** Kokoro's audio plays through the page's own `AudioContext`. The browser's echo cancellation can subtract audio the page plays itself, but probably not `speechSynthesis`, which plays through the operating system. Hands-free mode (next) needs that, so the agent doesn't hear itself.
- **The download.** The model is about 90 MB the first time, then the browser caches it. It starts at the first mic press, never on page load, so people who only type never download it.

## 3. Measured (Chrome on a Mac, WebGPU)

| Stage                                      | Time                           |
| ------------------------------------------ | ------------------------------ |
| Model download + load (first visit)        | ~19 s (cached afterwards)      |
| Warm-up (once, hidden)                     | ~2.7 s                         |
| A 34-character sentence                    | **~0.7 s** to generate         |
| The same sentence again                    | instant (cache)                |

The spec §8 budget for "TTS start" is 150 ms (p50). The browser voice starts in about 100 ms, but Kokoro needs about 0.7 s per new sentence. Prefetching hides that for every sentence after the first. Possible next steps: split the first sentence at a comma, or start with the browser voice for the first few words. On WASM (no WebGPU), expect it to be several times slower.

## 4. Potential holes

| What could go wrong                                     | What happens                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Kokoro fails to load (blocked CDN, no WebGPU/WASM)      | `warmUp` logs "kokoro unavailable" and the browser voice keeps speaking.                 |
| A reply arrives before Kokoro is ready                  | It's spoken by the browser voice (`kokoro-tts.test.ts` › "speaks with the browser voice until Kokoro is ready…"). |
| Barge-in while Kokoro is speaking                       | `cancel()` stops the playing audio, and both voices are cancelled ("barge-in cancels both voices"). |
| A voice switches halfway through a sentence             | It can't: the voice is chosen per sentence.                                              |
| A sentence fails to generate                            | Its `onEnd` still fires, so the queue never stalls.                                      |

## 5. Quiz

1. Why did the old voice sound robotic, and what's the free fix that needs no model?
2. Why does Kokoro run in a Web Worker?
3. What is warm-up, and why do it before the first reply?
4. How does `prepare` hide Kokoro's 0.7 s per sentence?
5. Why is Kokoro served from `public/` instead of being bundled by webpack?
6. Why does playing Kokoro through an `AudioContext` matter for hands-free mode?

<details>
<summary>Answers</summary>

1. The code never chose a voice, so the browser used its default, often an old system voice. Picking the best installed voice (Natural/Google/Enhanced) fixes much of it for free.
2. Generating audio is heavy math that takes hundreds of milliseconds. On the main thread it would freeze the page; in a worker it runs alongside it.
3. The first generation compiles the GPU programs (~2.7 s). Doing it right after loading means the caller's first reply doesn't pay for it.
4. As soon as a sentence is queued, Kokoro starts generating it, so it is usually ready by the time the previous sentence finishes playing.
5. Kokoro's runtime loads its own files with dynamic imports, which webpack rewrites and breaks. Served as a static file, the browser loads them natively.
6. The browser can only cancel echo it knows about. Audio the page plays itself can be subtracted from the mic; the OS-level `speechSynthesis` probably can't. Without that, the agent would hear itself and interrupt itself.

</details>
