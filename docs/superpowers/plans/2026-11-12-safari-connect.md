# Safari connection: fail clearly, never spin forever — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the live site, a browser that can't pass Turnstile or can't keep the socket open sees a clear message instead of an endless "Connecting…"/"Reconnecting…".

**Architecture:** Turnstile failures (error/timeout/unsupported) reject the token promise after one retry; `connectChat` turns a rejected token into `bot_check_failed`. Consecutive closes that never received a `session` are capped; after the cap the socket reports a new `unreachable` status and stops. Close codes are logged for diagnosis.

**Tech Stack:** TypeScript, React 19 / Next 16, vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-voice-agent-design.md` §5.8

## Global Constraints

- Changes stay in `apps/web/src/chat/`. The one line in `apps/web/src/components/chat/chat-window.tsx` (a label for `unreachable`) is announced to session `local_2b8cc036-6517-4a3f-8269-da4dfaf2876e` before editing.
- No secrets in logs; the Turnstile token is never logged (it's in the URL — log only the close code and reason).
- PR into `main` from its own branch off `main`; adds `docs/learning/safari-connect.md`.

## Review Focus

- A Turnstile widget that errors, then succeeds on the retry → the chat connects normally (no message flashes).
- A socket that opens, gets a `session`, then drops repeatedly (Render restarts) → keeps reconnecting forever as today; only never-connected loops are capped.
- `unreachable` after a reload → a reload starts from scratch (the cap is per page load).
- The token promise rejecting after `close()` → nothing happens (no event after stop).
- Real Safari: the user checks the live site after deploy and reports the status text and console close code.

---

### Task 1: Turnstile failures reject instead of hanging

**Files:**
- Modify: `apps/web/src/chat/turnstile.ts`, `apps/web/src/chat/use-turnstile.ts`
- Test: `apps/web/src/chat/turnstile.test.ts`

**Interfaces:**
- Produces: `TurnstileApi.render` options gain `"error-callback"`, `"timeout-callback"`, `"unsupported-callback"`, `"expired-callback"` (all `() => void`). `TurnstileTokens.next(): Promise<string>` now **rejects** with `Error("turnstile failed")` after the second failure; `TurnstileTokens` constructor gains optional 4th arg `onFailed?: () => void`.

- [ ] **Step 1: Write failing tests** in `turnstile.test.ts` (extend `fakeApi` to capture the failure callbacks and expose `fail(kind)`):
  - `"retries once after an error, then resolves"`: `next()`, `fail("error")` → `resets() === 1`; `solve("t1")` → resolves `"t1"`.
  - `"rejects and reports after two failures"`: `next()`, `fail("error")`, `fail("timeout")` → rejects `"turnstile failed"`, `onFailed` called once.
  - `"unsupported fails at once"`: `fail("unsupported")` → rejects without a reset.
  - `"an expired unused token is not handed out"`: `solve("old")`, `fail("expired")`, `next()` pending until `solve("new")` → `"new"`.
- [ ] **Step 2:** `pnpm test apps/web/src/chat/turnstile.test.ts` → the 4 new tests FAIL.
- [ ] **Step 3: Implement** in `TurnstileTokens`: a failure counter reset on each solve; first error/timeout → `api.reset(widgetId)`; second, or `unsupported` → reject the waiting `next()` (and any later `next()`) and call `onFailed`. `expired` clears `ready`. In `use-turnstile.ts` pass `() => setFailed(true)` as `onFailed` (the existing alert in chat-window then shows).
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5: Commit** `fix(web): Turnstile errors fail clearly instead of hanging`.

### Task 2: The socket gives up on never-connected loops

**Files:**
- Modify: `apps/web/src/chat/socket.ts`, `apps/web/src/chat/state.ts`, `apps/web/src/components/chat/chat-window.tsx` (one label, after notifying the UI session)
- Test: `apps/web/src/chat/socket.test.ts`, `apps/web/src/chat/state.test.ts`

**Interfaces:**
- Consumes: `TurnstileTokens.next()` may reject (Task 1).
- Produces: `ChatState["status"]` and the socket event union gain `"unreachable"`; `export const MAX_FAILED_OPENS = 5` in `socket.ts`; `SOCKET_NOTICES.unreachable = "We couldn't reach the receptionist. Please reload, or try Chrome."`.

- [ ] **Step 1: Write failing tests** in `socket.test.ts` (use its existing fake WebSocket + fake timers):
  - `"stops after MAX_FAILED_OPENS closes without a session and reports unreachable"`: 5 closes with code 1006 and no `session` message → last event `{type:"socket",status:"unreachable"}`, no 6th socket constructed after timers run.
  - `"a session resets the count"`: 4 failing closes, then one socket sends `session` and closes → status `reconnecting` and a new socket is opened.
  - `"a rejected bot token reports bot_check_failed"`: `botToken: () => Promise.reject(new Error("x"))` → event `bot_check_failed`, no socket opened.
  - `"logs the close code"`: spy `console.warn`, close with 1006 → called with a string containing `1006`, and never with `ts=`.
  In `state.test.ts`: `"unreachable shows its notice"` → `notice === SOCKET_NOTICES.unreachable` text above.
- [ ] **Step 2:** `pnpm test apps/web/src/chat` → new tests FAIL.
- [ ] **Step 3: Implement**: count consecutive closes since the last `session`; at `MAX_FAILED_OPENS` emit `unreachable` and stop scheduling. `open()` catches a rejected `botToken()` → `bot_check_failed` (unless stopped). `console.warn(\`chat socket closed: ${e.code} ${e.reason}\`)` on every close. Add `unreachable` to state types and notices. Message session `local_2b8cc036-6517-4a3f-8269-da4dfaf2876e`, then add `unreachable: "Unavailable"` to the status label map in `chat-window.tsx`.
- [ ] **Step 4:** `pnpm test apps/web/src/chat && pnpm typecheck` → PASS.
- [ ] **Step 5: Learning note** `docs/learning/safari-connect.md`: what Turnstile is, why automated browsers never pass it, the four callbacks, why only never-connected loops are capped, how to read the console close code; 3–4 quiz questions.
- [ ] **Step 6: Commit** `fix(web): stop endless reconnects and say why`. Push, open PR into `main`, then ask the user to check real Safari after deploy and report the status + console close code.
