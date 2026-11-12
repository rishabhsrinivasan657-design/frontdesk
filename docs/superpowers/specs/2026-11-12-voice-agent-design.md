# Voice agent v2: hands-free, natural turn-taking, better voices (design)

Date: 2026-11-12. Builds on M7 (`docs/learning/m7-voice.md`) and spec §8 of `2026-10-22-frontdesk-design.md`.

## 1. Intent

The user will pitch themselves as someone who is good at voice agents, with Front Desk (the Casa Fiorella
receptionist) as the evidence. Voice must therefore be the strongest part of the project: it has to *feel*
natural to a caller, and every design choice has to stand up to questions from people who build voice
agents ("how do you detect end of turn?", "how do you handle echo?", "what's your latency budget and where
does it go?").

Today voice is push-to-talk on the browser's Web Speech API. Callers get cut off or talked over, the
browser voice sounds robotic, Safari doesn't connect on the live site, and the slowest stage (Gemini's
first token) is felt as dead air.

## 2. Goals, non-goals, anti-goals

**Goals**
- **Hands-free conversation** (chosen by the user): start once, then just talk. The agent listens, decides
  when you've finished, replies, and stops when you talk over it.
- **Turn-taking that doesn't cut people off and doesn't lag**: end of turn decided from several signals
  (voice activity, whether the words sound finished, an audio turn model), adapted to the caller.
- **Natural barge-in**: talking over the agent pauses it at once and interrupts it only if you really
  meant to speak (not a cough or "mm-hm").
- **A natural voice**: Kokoro (open neural TTS) running in the browser by default, the best browser voice
  as fallback, and ElevenLabs available **for comparison only** (user's call: not the default, not the only
  voice).
- **Safari works or fails clearly**: never an endless "Connecting…"/"Reconnecting…".
- **Latency measured per stage against spec §8**, worst stage improved (or masked) on the voice side.
- **A short pitch write-up** of the voice design, plus a learning note per PR for the user.

**Non-goals**
- Phone calls / PSTN, languages other than English, server-side speech-to-text, voice cloning.
- Replacing Web Speech recognition in Chrome (it is the fastest and most accurate free option there).
- Fixing Gemini free-tier queueing itself (covered by the hedge in `llm-latency.md`).

**Anti-goals (it fails even if it "works")**
- A spoken "yes" that bypasses the confirmation gate. Voice still only sends caller text and `interrupt`.
- The agent hearing itself through the speakers and interrupting itself.
- Any money spent: ElevenLabs stays inside its free monthly credits, enforced by the api.
- A big model download that blocks the first interaction: the page is usable at once, models load behind it.
- An ElevenLabs key reachable from the browser, or our api usable as a free TTS for arbitrary text.

## 3. Constraints

- $0: Render free tier, Gemini free tier (no extra keys/projects), free ElevenLabs tier, open models from
  public CDNs (Hugging Face / jsDelivr).
- Keep the `SpeechToText` / `TextToSpeech` interfaces; new providers implement them.
- Coordination: the `/talk` page is being redesigned in parallel (an orb UI) in another session. Voice
  changes stay in `apps/web/src/voice/` (and `apps/web/src/chat/` for Safari). `useVoice` stays the one
  interface the page reads; new states are exposed from it. Any edit under `components/chat/` is announced
  to that session first.
- Small PRs into `main`, never stacked; each adds/updates a note in `docs/learning/`.
- TDD; secrets never printed or committed. No Google Cloud setting changes.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | **Light**: Web Speech STT + a small VAD + text-based adaptive silence, best browser voice | Quick, tiny download; voice stays robotic and barge-in is crude because browser TTS can't be echo-cancelled |
| B | **All in-browser**: VAD + Smart Turn + Moonshine/Whisper STT + Kokoro | Nothing leaves the browser, could work everywhere; ~200 MB first load, heavy on phones, slower STT than Google's — risky demo |
| **C** | **Hybrid (chosen)**: Web Speech STT; VAD + Smart Turn + text rules for end of turn; Kokoro through the page's own audio (so echo cancellation works) with browser-voice fallback; ElevenLabs as an opt-in comparison | Best free tool per job; moderate download loaded in the background; most pieces to build, shipped in small PRs |

The user picked C, and added ElevenLabs "only for comparison".

## 5. Design

### 5.1 Audio front end (new `voice/mic.ts`)
One `getUserMedia({ audio: { echoCancellation, noiseSuppression, autoGainControl } })` stream feeds an
AudioWorklet that emits 16 kHz mono frames to the VAD and (later) Smart Turn. Web Speech recognition keeps
its own capture in parallel (Chrome allows both). The stream is opened when the caller starts hands-free
mode and closed when they stop or leave the page.

### 5.2 Voice activity detection
Silero VAD v5 via `@ricky0123/vad-web` (ONNX in onnxruntime-web, ~2 MB, MIT). Emits `speechStart`,
`speechEnd`, and a per-frame probability. Assets are served from the web app's own `public/` (copied at
build) so the CSP and offline behaviour are predictable.

### 5.3 Endpointer (new `voice/endpointer.ts`, pure TS, fully unit tested)
Decides end of turn from events, with injected time. Inputs: VAD speech start/end, interim transcript
changes, optional Smart Turn probability. After VAD `speechEnd`, it waits a silence window chosen by how
finished the turn sounds:

| Signal | Window (initial values, tunable) |
|---|---|
| Text sounds finished (short answers: yes/no/that's right/thanks; a complete request) or Smart Turn p ≥ 0.7 | ~300 ms |
| Neutral | ~700 ms |
| Text sounds unfinished (ends in "for", "at", "and", "the", "um", a number awaiting a unit, …) or Smart Turn p ≤ 0.3 | ~2000 ms |
| Hard cap | 3000 ms of silence always ends the turn |

- **Text rules** (`voice/turn-text.ts`): small, deterministic, domain-aware rules over the interim
  transcript; unit tested with a table of real phrasings.
- **Speaker adaptation**: the endpointer records pauses that were followed by more speech (the caller's
  mid-sentence pauses) and raises the neutral window towards their ~p90 (bounded).
- **Transcript catch-up**: Web Speech words lag the audio, so the turn is sent only once the interim
  text has been stable ~200 ms after the window (bounded), so the last word isn't lost.
- Push-to-talk tap still sends immediately.
- Speech resuming inside the window cancels it (no cut-off).

### 5.4 Smart Turn v3 (later PR, `voice/smart-turn.ts`)
Pipecat's open audio turn-detection model (BSD-2, ~8 MB int8 ONNX, Whisper-tiny encoder over the last
≤ 8 s of audio). Run on `speechEnd` in a Web Worker via onnxruntime-web; its probability feeds the
endpointer. In-browser inference time is unmeasured publicly, so the PR measures it; if it's too slow on a
device, the endpointer simply runs without it.

### 5.5 Hands-free loop and barge-in (`voice/controller.ts` evolves)
States exposed from `useVoice`: `off | listening | hearing (caller speaking) | thinking | speaking`, plus
the interim transcript and an input level for the orb. The mic button / orb toggles the conversation.

Barge-in while the agent speaks:
1. VAD `speechStart` → **duck** (pause) the agent's audio immediately.
2. **Commit** if speech lasts ≥ ~300 ms or Web Speech produces ≥ 2 words → stop speaker, send `interrupt`
   (existing M7 semantics: uncancellable turns are replayed, held text is dropped, gate untouched).
3. Otherwise (cough, "mm-hm") → resume where it paused.

Echo: Kokoro and ElevenLabs play through the page's Web Audio, which Chrome's echo canceller can subtract.
Browser voices (`speechSynthesis`) are believed to play outside it, so with the browser-voice fallback the
barge-in thresholds are raised (and transcripts heard while the agent talks must match the commit rule).
**This belief is verified by a spike before PR 4 relies on it.**

### 5.6 Text-to-speech providers (all implement `TextToSpeech`)
- **Kokoro** (`voice/kokoro-tts.ts`): `kokoro-js` in a Web Worker; WebGPU (fp32) when available, else WASM
  (q8). Loads in the background after the page is interactive; synthesizes the next sentence while the
  current one plays; plays through one `AudioContext`. ~80–90 MB, cached by the browser after first visit.
- **Browser voice** (`web-speech.ts`): fallback until Kokoro is ready, or when it can't run. Picks the best
  installed English voice (e.g. "Google US English", "… (Natural)", "… (Enhanced/Premium)") instead of the
  default.
- **ElevenLabs** (comparison only): `?voice=elevenlabs` on `/talk`. Default is Kokoro;
  `?voice=kokoro|browser` force the others so the user can compare. A small "Voice by ElevenLabs" credit
  shows while it's in use.
  - The api holds `ELEVENLABS_API_KEY` (Render env, `sync: false`); unset = feature off.
  - The browser asks for audio of a sentence *the server itself sent in this session* (by turn id +
    sentence index), never arbitrary text.
  - The api keeps a monthly character count (Redis) and refuses past a cap below the free allowance;
    the browser then falls back to Kokoro. Model: Flash v2.5 (lowest latency, half-price credits).
  - The user creates the ElevenLabs account and sets the key in Render themselves.

### 5.7 Latency
- New client-side measurements exposed by `useVoice`: endpoint delay (speech end → turn sent),
  `stt_ms`, LLM first sentence (sent → first `agent_sentence`), TTS start, and **voice turn total**
  (caller stops speaking → agent audio starts). Server `tts_start_ms` stays.
- A short report (`docs/learning/voice-latency.md`) measures each stage against spec §8 on the live site.
- Expected worst stage: Gemini free-tier first token. Voice-side mitigation: if no sentence has arrived
  ~800 ms after the turn is sent, play a short pre-synthesized acknowledgement ("One moment.") locally.
  It is never sent as agent text and never affects the gate.

### 5.8 Safari
Root cause still to be confirmed on real Safari (automated WebKit/Chromium can't pass Turnstile, so they
show an endless "Connecting…" with no message). Fixes that hold whatever the cause:
- Wire Turnstile's `error-callback`, `timeout-callback` and `unsupported-callback` to the existing
  `turnstile.failed` message, with one automatic retry.
- Stop reconnecting after a few attempts that never got a `session`, and show a clear message
  ("Couldn't reach the receptionist. Try Chrome, or reload."). Log the close code to the console.
- If the real cause turns out to be different (e.g. a Safari WebSocket quirk), fix that too.
- Voice in Safari: Web Speech recognition exists there but is unreliable in continuous mode; Safari gets
  push-to-talk if hands-free misbehaves, decided during PR 4 testing.

### 5.9 Safety (unchanged rules, restated)
Voice can send only caller text (through `sendText`, i.e. `user_text`) and `interrupt`. Hands-free makes
sending automatic, so the gate's protections (confirm only a read-back that is pending and was heard;
interrupted proposals voided) carry all the weight; existing tests stay green and new tests cover:
endpointed text is only ever `user_text`; barge-in during an uncancellable turn drops what was heard.

## 6. Delivery (small PRs into `main`)

1. **Endpointing fix** (existing commit 51dd9fc) — after the user tries it with a real mic.
2. **Safari**: Turnstile callbacks, reconnect cap, clear message.
3. **Endpointer + VAD**: `endpointer.ts`, `turn-text.ts`, `mic.ts`, VAD; used in push-to-talk first.
4. **Hands-free + barge-in** (after the echo spike).
5. **Kokoro TTS + best browser voice**.
6. **ElevenLabs comparison**.
7. **Smart Turn v3**.
8. **Latency**: measurements, acknowledgement, report; **pitch write-up** (`docs/voice-pitch.md`).

Each PR: tests first, a learning note, and a manual check in Chrome.

## 7. Left to the builder
- Exact thresholds (windows, barge-in commit) — start from the values above, tune by trying it.
- Kokoro voice choice (e.g. `af_heart`), WebGPU/WASM detection details, worker plumbing.
- How the endpointing events are logged for tuning (dev-only console is fine).
- Which ElevenLabs voice; the exact monthly cap (keep it ≥ 10% under the free allowance).
- UI wording for new states, coordinated with the orb session (the page reads `useVoice` only).
- Idle timeout: hands-free turns itself off after ~30 s with no speech (frees the mic, saves Web Speech sessions). My call; tune freely.
