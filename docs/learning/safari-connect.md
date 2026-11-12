# Safari: failing clearly instead of spinning (learning guide)

On the live site, Safari never got into a chat: the page kept saying "Connecting…" or "Reconnecting…". This change doesn't guess at one cause. It makes **every** way of not getting in end in a clear message, and it logs enough for us to see which cause it was.

## 1. Reading order

| #   | File                                 | What changed                                                                                                                    |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/web/src/chat/turnstile.ts`     | `TurnstileTokens` listens to Turnstile's failure callbacks, retries once, then rejects and calls `onFailed`.                    |
| 2   | `apps/web/src/chat/use-turnstile.ts` | `onFailed` sets `failed`, which shows the existing "security check couldn't load" alert.                                        |
| 3   | `apps/web/src/chat/socket.ts`        | A rejected token becomes `bot_check_failed`; 6 closes in a row without a `session` become `unreachable`; every close is logged. |
| 4   | `apps/web/src/chat/state.ts`         | The `unreachable` status and its notice; a later `session` clears it.                                                           |
| 5   | `apps/web/src/chat/*.test.ts`        | The behaviour, with a fake Turnstile, a fake WebSocket and fake timers.                                                         |

## 2. Key concepts

- **Turnstile.** Cloudflare's bot check. A hidden widget runs a challenge in the browser and hands us a **token**; the api sends it to Cloudflare (`siteverify`) and only then opens a chat. A token works once.
- **Why it can hang.** Before this change we only listened for the success `callback`. If the challenge errored, timed out, or the browser wasn't supported, nothing ever called us back, so the socket waited for a token forever: "Connecting…" with no message. Automated browsers (Playwright's Chromium and WebKit) show exactly this on the live site, because Turnstile is built to fail them.
- **The four callbacks.** `error-callback` and `timeout-callback`: the challenge failed (we reset the widget and try once more; a second failure is final). `unsupported-callback`: this browser can't run Turnstile (final at once). `expired-callback`: an unused token went stale, so we throw it away.
- **Close codes.** When a WebSocket closes, the browser gets a number. Ours: `4000` another tab took over, `4429` rate limited, `4403` bot check failed. `1006` means the connection died with no close frame (network, proxy, server crash). The page now prints `chat socket closed: <code> <reason>` in the console, so the browser's dev tools show which one happened. It never prints the URL, because the URL carries the one-time token.
- **Only never-connected loops are capped.** A socket that got a `session` and later dropped (the api restarting) is a normal outage: it keeps retrying as before. Six closes in a row _without_ a `session` (about 8 s of backoff) means retrying isn't working, so the page says "We couldn't reach the receptionist. Please reload, or try Chrome." It still tries every 4 s after that, because a sleeping free-tier api can take a while to wake; if it gets in, the notice disappears.

## 3. Potential holes and the tests that guard them

| What could go wrong                             | Guarded by                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| One flaky challenge kills the chat              | `turnstile.test.ts` › "retries once after an error, then resolves"                                           |
| A dead challenge leaves "Connecting…" forever   | "rejects and reports after two failures"; `socket.test.ts` › "a rejected bot token reports bot_check_failed" |
| A stale token is used and refused               | "an expired unused token is not handed out"                                                                  |
| "Reconnecting…" forever                         | "after MAX_FAILED_OPENS closes without a session it says unreachable, and keeps trying slowly"               |
| A normal api restart is reported as unreachable | "a session resets the count"                                                                                 |
| The one-time token leaks into logs              | "logs the close code but never the bot token"                                                                |
| The notice sticks after we got in               | `state.test.ts` › "a session after unreachable clears its notice"                                            |

## 4. Quiz

1. Why did the page say "Connecting…" forever instead of showing an error?
2. Why retry a failed Turnstile challenge once, but not forever?
3. What does close code 1006 tell you, and where do you see it now?
4. Why does a socket that once got a `session` keep retrying, while one that never did is reported after 6 tries?
5. Why don't we log the WebSocket URL?

<details>
<summary>Answers</summary>

1. We only listened for Turnstile's success callback. A failed challenge never called us, so the socket waited for a token that never came.
2. Challenges fail occasionally for harmless reasons, and one retry fixes those. If it fails twice, the browser or its privacy settings are blocking it, and retrying would just hang again.
3. The connection ended without a proper close frame: a network, proxy or server problem rather than a deliberate refusal. It's printed in the browser console as `chat socket closed: 1006`.
4. Getting a `session` proves this browser can get in, so a drop is an outage that will pass. Never getting one means something about this browser or network blocks us, and the caller deserves to know.
5. The URL carries the one-time Turnstile token (`?ts=…`), and tokens don't belong in logs.

</details>
