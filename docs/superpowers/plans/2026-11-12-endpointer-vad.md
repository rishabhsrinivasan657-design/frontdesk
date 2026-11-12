# Endpointer + VAD: deciding when the caller has finished — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed 1.5 s word-silence timer with an endpointer that listens for real silence (Silero VAD) and chooses how long to wait from how finished the words sound, adapted to the caller's own pauses. Still push-to-talk in this PR.

**Architecture:** Three pure, unit-tested pieces — `turn-text.ts` (do the words sound finished?), `endpointer.ts` (state machine over VAD and transcript events with injected time), `endpointed-stt.ts` (a `SpeechToText` that composes a raw Web Speech recogniser, a VAD and the endpointer) — plus `vad.ts`, a thin adapter over `@ricky0123/vad-web`. If the VAD can't load, `providers.ts` falls back to today's Web Speech silence timer. The controller and the page don't change.

**Tech Stack:** TypeScript, vitest, `@ricky0123/vad-web@0.0.31` (Silero v5 ONNX, `onnxruntime-web`), Next static assets.

**Spec:** `docs/superpowers/specs/2026-11-12-voice-agent-design.md` §5.2, §5.3

## Global Constraints

- Windows (start values, exported as constants so tuning is one edit): `COMPLETE_MS = 300`, `NEUTRAL_MS = 700`, `INCOMPLETE_MS = 2000`, `HARD_CAP_MS = 3000`; adaptive neutral bounded to `[700, 1500]`, needs ≥ 3 recorded pauses, uses their p90 + 100 ms; catch-up: wait until interim text unchanged for `STABLE_MS = 200`, at most `MAX_CATCHUP_MS = 600` extra.
- Voice still sends only caller text via `onFinal` → `sendText`; `interrupt` unchanged.
- Files only under `apps/web/src/voice/`, plus `apps/web/package.json`, a copy script and `apps/web/public/vad/` (gitignored, generated). No edits to `components/chat/`.
- `SpeechToText`/`TextToSpeech` interfaces unchanged.
- PR into `main` from its own branch off `main`; updates `docs/learning/m7-voice.md` §2 Endpointing and adds `docs/learning/endpointing.md`.

## Review Focus

- Caller says nothing but the VAD fires (a cough, a door) → no empty `user_text` is ever sent; listening ends at the hard cap with no final.
- Web Speech words arrive after the VAD says silence (common in Chrome) → the late last word is included in the sent text.
- Caller resumes speaking inside the window ("a table for… four") → nothing is sent until they stop again.
- Tapping the mic mid-sentence → sends at once (existing behaviour), exactly one `onFinal`.
- VAD model fails to load (blocked CDN, old browser) → voice still works with the 1.5 s timer, no error shown.

---

### Task 1: `turnCompleteness` — do the words sound finished?

**Files:**
- Create: `apps/web/src/voice/turn-text.ts`
- Test: `apps/web/src/voice/turn-text.test.ts`

**Interfaces:**
- Produces: `export type Completeness = "complete" | "incomplete" | "neutral"`; `export function turnCompleteness(text: string): Completeness`.

- [ ] **Step 1: Write the failing table test** `it.each` with exact expectations:
  - complete: `"yes"`, `"Yes please."`, `"no thanks"`, `"that's right"`, `"correct"`, `"thank you"`, `"A table for 4 on Friday at 7pm"`, `"My name is Ana Lopez"`, `"cancel it"`.
  - incomplete: `"a table for"`, `"on Friday at"`, `"for four and"`, `"my name is"`, `"um"`, `"I'd like to book a table for uh"`, `"at 7 or"`, `"can I"`, `""`.
  - neutral: `"I was wondering about the menu"`, `"Friday"`, `"we are celebrating a birthday"`.
- [ ] **Step 2:** `pnpm test apps/web/src/voice/turn-text.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement**: normalise (lowercase, strip punctuation); empty → incomplete; last word in a dangling set (prepositions, articles, conjunctions, fillers `um uh er erm like`, auxiliaries `is are can could would i'd`, `my name is`) → incomplete; whole text in a short-answer set, or contains a time/date/party-size pattern and ends in a content word → complete; else neutral.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(voice): judge whether a transcript sounds finished`.

### Task 2: `Endpointer` — the state machine

**Files:**
- Create: `apps/web/src/voice/endpointer.ts`
- Test: `apps/web/src/voice/endpointer.test.ts`

**Interfaces:**
- Consumes: `turnCompleteness` (Task 1); `Timers` from `web-speech.ts`.
- Produces:
  ```ts
  export interface EndpointerOptions {
    timers: Timers; now: () => number;
    onEndOfTurn(text: string, speechEnd: number): void;
  }
  export class Endpointer {
    constructor(o: EndpointerOptions);
    speechStart(): void;            // VAD heard speech
    speechEnd(at?: number): void;   // VAD silence began (at defaults to now(); adapter passes now − redemption)
    transcript(text: string): void; // latest interim/final text of the whole utterance
    flush(): void;                  // tap / session ended: emit now if there is text
    reset(): void;                  // forget everything (new utterance)
    /** The neutral window currently in use (adaptation), for logging and tests. */
    get neutralMs(): number;
  }
  export const COMPLETE_MS, NEUTRAL_MS, INCOMPLETE_MS, HARD_CAP_MS, STABLE_MS, MAX_CATCHUP_MS;
  ```
  Emits `onEndOfTurn` at most once per utterance (until `reset()`).

- [ ] **Step 1: Write failing tests** with a manual clock + fake `Timers` (pattern from `web-speech.test.ts`):
  - `"complete text ends the turn 300 ms after silence"`: transcript `"yes"`, speechEnd at t=0 → nothing at 299, emitted `("yes", 0)` at 300.
  - `"unfinished text waits 2 s"`: `"a table for"` → nothing at 1999 → emitted at 2000.
  - `"neutral text waits 700 ms"`.
  - `"speech resuming cancels the window"`: `"a table for"`, end at 0, start at 500, transcript `"a table for four"`, end at 900 → emitted at 1200 (complete) with `"a table for four"`.
  - `"words that arrive during the window re-pick it from speechEnd"`: `"a table for"`, end at 0, at 400 transcript `"a table for four on friday at 7"` (complete) → emitted at ≥ 600 after text stable 200 ms (i.e. at 600).
  - `"waits for late words to settle"`: `"yes"`, end at 0, transcript changes at 250 to `"yes please"` → emitted at 450.
  - `"catch-up is bounded"`: text keeps changing every 100 ms → emitted by 300 + 600.
  - `"never emits empty text"`: speechEnd with no transcript → nothing by `HARD_CAP_MS + MAX_CATCHUP_MS`.
  - `"hard cap"`: neutral text, adaptive window can't exceed; emit by 3000.
  - `"adapts to a slow speaker"`: three pauses of 1000/1100/1200 ms that were followed by speech → `neutralMs` = 1300 (p90 1200 + 100); bounded at 1500 for longer pauses.
  - `"flush emits now, once"`; `"reset forgets text and allows a new emit"`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement**: on `speechEnd` record `endAt`, arm a timer for `window(text) − (now − endAt)`; `transcript` during a pending window re-arms from `endAt`; on fire, if text changed < `STABLE_MS` ago and catch-up budget left, re-arm for the remainder; `speechStart` during a pending window records pause `now − endAt` into a list (keep last 20) and cancels. Window = complete → `COMPLETE_MS`, incomplete → `INCOMPLETE_MS`, neutral → `neutralMs`; all `min(…, HARD_CAP_MS)`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(voice): endpointer picks the silence window from the words`.

### Task 3: VAD adapter + endpointed STT

**Files:**
- Create: `apps/web/src/voice/vad.ts`, `apps/web/src/voice/endpointed-stt.ts`
- Modify: `apps/web/src/voice/web-speech.ts` (option to disable its own timer), `apps/web/src/voice/fakes.ts` (a `FakeVad`)
- Test: `apps/web/src/voice/endpointed-stt.test.ts`, `apps/web/src/voice/web-speech.test.ts`

**Interfaces:**
- Consumes: `Endpointer` (Task 2).
- Produces:
  ```ts
  // vad.ts
  export interface VadHandlers { onSpeechStart(): void; onSpeechEnd(at: number): void }
  export interface Vad { start(h: VadHandlers): Promise<void>; stop(): void }
  export function createSileroVad(): Vad; // MicVAD v5, assets from "/vad/", redemptionMs 200, minSpeechMs 150,
                                          // echoCancellation/noiseSuppression/autoGainControl on; at = now − redemptionMs
  // web-speech.ts
  export function createWebSpeechStt(g?, now?, timers?, opts?: { silenceMs?: number | null }): SpeechToText
  // null = never end the utterance on its own (only stop()/session end)
  // endpointed-stt.ts
  export function createEndpointedStt(o: { recognizer: SpeechToText; vad: Vad; now?: () => number; timers?: Timers }): SpeechToText
  ```
  `createEndpointedStt` is `supported` iff the recogniser is; forwards `onSpeechStart`/`onInterim`/`onError`; feeds interim text and VAD events to an `Endpointer`; on end of turn calls `onFinal(text, { speechEnd, sttFinal: now() })` once and stops the recogniser and the VAD; `stop()` flushes (tap to send). If `vad.start` rejects, it keeps going with the recogniser's interim-change timing (calls `endpointer.speechEnd(now)` on each interim) — simplest equivalent of today's timer.

- [ ] **Step 1: Write failing tests**:
  - `web-speech.test.ts` › `"silenceMs: null never finalizes on its own"`: interim then advance 10 s → no final; `stop()` → onend → one final.
  - `endpointed-stt.test.ts` (FakeRecognition-backed recogniser via `createWebSpeechStt(..., {silenceMs:null})` + `FakeVad`):
    - `"sends once when the VAD says silence and the words sound finished"`: interim `"yes"`, vad end → final `"yes"` after 300 ms, exactly one `onFinal`, recogniser stopped.
    - `"includes a word that arrives after the VAD's silence"`.
    - `"the recogniser's late final after we finished doesn't send twice"`.
    - `"tap (stop) sends what was heard now"`.
    - `"no words, only noise → no final, onEnd fires"`.
    - `"VAD failing to start falls back to word timing"`: `FakeVad.start` rejects → interim `"a table for four"` → final 300 ms after the last word change (it sounds complete).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** the three pieces as specified. `createSileroVad` dynamically `import("@ricky0123/vad-web")` so the model only loads when voice starts.
- [ ] **Step 4:** PASS; existing `controller.test.ts`/`web-speech.test.ts` still pass.
- [ ] **Step 5: Commit** `feat(voice): endpoint with Silero VAD instead of word gaps`.

### Task 4: Wire it in, ship the assets, document

**Files:**
- Modify: `apps/web/src/voice/providers.ts`, `apps/web/package.json`, `.gitignore`, `Dockerfile` only if the copy step needs it
- Create: `apps/web/scripts/copy-vad-assets.mjs`
- Docs: `docs/learning/endpointing.md`, `docs/learning/m7-voice.md`

**Interfaces:**
- Consumes: `createEndpointedStt`, `createSileroVad`, `createWebSpeechStt(..., {silenceMs:null})`.

- [ ] **Step 1:** `pnpm --filter @frontdesk/web add @ricky0123/vad-web@0.0.31`. Add `copy-vad-assets.mjs` (copies `silero_vad_v5.onnx`, `vad.worklet.bundle.min.js` and the `onnxruntime-web` `ort-wasm-simd-threaded*.{wasm,mjs}` files into `apps/web/public/vad/`), run it from `predev` and `prebuild`; gitignore `apps/web/public/vad/`.
- [ ] **Step 2:** `providers.ts`: when Web Speech recognition is supported and `AudioWorkletNode` exists, return `createEndpointedStt({ recognizer: createWebSpeechStt(undefined, undefined, undefined, { silenceMs: null }), vad: createSileroVad() })`; else today's `createWebSpeechStt()`. The e2e hook path is unchanged.
- [ ] **Step 3: Verify**: `pnpm verify` → PASS; `pnpm --filter @frontdesk/web build` → succeeds and `apps/web/.next` build includes `/vad/` assets served (check `curl -sI localhost:3000/vad/silero_vad_v5.onnx` → 200 under `pnpm web`).
- [ ] **Step 4: Manual check in Chrome** (`pnpm web` + scripted api per `m6-chat.md`): say "a table for… [pause 1 s] four people" → one message; say "yes" → sent within ~0.5 s. Log endpoint decisions to the console in dev only.
- [ ] **Step 5: Learning note** `docs/learning/endpointing.md`: endpointing, VAD, why word gaps are a bad signal, the window table, adaptation, catch-up, fallback; quiz. Update `m7-voice.md` §2 Endpointing to point to it.
- [ ] **Step 6: Commit** `feat(voice): ship Silero VAD endpointing`, push, open PR into `main`.
