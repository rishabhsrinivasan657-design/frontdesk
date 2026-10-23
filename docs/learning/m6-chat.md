# M6: Chat over WebSockets (learning guide)

M6 is the first milestone you can use. A caller types at `/talk`, the browser sends each message over a WebSocket, and the api runs the same M3 agent loop the tests and evals use. Sessions live in Redis, so a dropped connection picks up where it left off. Every turn's latency, tokens and cost are stored in Postgres. Part A (this PR) built the api. Part B adds the web page, Playwright and CI.

## 1. Reading order

| #   | File (under `apps/api/src/` unless noted)                           | What it's for                                                                                                                          |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/core/src/protocol/messages.ts`                            | Every message the browser and server may send. M6 adds `session` (who you are, what to restore) and `error`.                           |
| 2   | `chat/connection.ts`                                                | `openChat`: one socket ↔ one session. It checks each message, runs one turn at a time, relays the loop's messages and stores the turn. |
| 3   | `server.ts`                                                         | Fastify with one WebSocket route `/ws`: origin check, 16 KiB frame limit, `?sessionId=` to resume.                                     |
| 4   | `redis/codec.ts` + `redis/session-store.ts`                         | Session state and the pending action in Redis, with Dates kept intact and an atomic "take".                                            |
| 5   | `redis/slot-lock.ts`                                                | The slot lock (spec §5) in Redis: `SET NX PX`, and release only by the lease that holds it.                                            |
| 6   | `metrics/latency.ts` + `metrics/turn-record.ts`                     | The p95 budget from spec §8, and the per-turn row written to `turns`.                                                                  |
| 7   | `llm/scripted.ts` + `llm/build.ts`                                  | A keyless, deterministic receptionist for tests and e2e, and how env picks Gemini or it.                                               |
| 8   | `deps.ts` + `main.ts`                                               | Picks every adapter from `.env` (Google or in-memory calendar, Redis, Postgres, the email queue) and starts the server.                |
| 9   | `chat/connection.test.ts`, `server.test.ts`, `server.smoke.test.ts` | The behavior, end to end: unit tests in memory, then a real socket, then real Redis and Postgres.                                      |

## 2. Key concepts

- **WebSocket vs HTTP.** HTTP is one request, one response, and then the server can't speak again until the browser asks. A WebSocket is one long-lived connection where either side can send at any time. A turn sends several messages (sentences, a read-back card, metrics), so the server needs to push.
- **Streaming.** The server sends the reply sentence by sentence as `agent_sentence` messages instead of one blob at the end. M3's loop only releases text after the grounding check has passed, so nothing unchecked reaches the screen. `agent_delta` (word by word) exists in the protocol for later.
- **Session + reconnect.** The server picks a random session id (`sess_<uuid>`) and sends it in the first `session` message. The browser keeps it. If the connection drops, it reconnects with `?sessionId=…`. The server loads the conversation from Redis and sends it back, including a read-back that is still waiting for "yes". An id the server doesn't know gets a fresh one, so nobody can pick their own.
- **Server vs client trust.** The browser is not trusted. It can only send caller _text_. The Confirm button sends the words "Yes, please", which go through the same gate as anything typed. No message type means "execute action X", and anything that isn't a valid message is refused with `bad_message`. The origin check stops another website from opening a socket in your name.
- **One turn at a time.** While a turn runs, a second message gets `busy`. Otherwise a flood of messages would queue up paid LLM calls.
- **Latency percentiles.** p50 is the typical turn (half are faster). p95 is the slow tail (19 of 20 are faster). The budget sets a p95 for each stage (LLM first token 1.5 s, each tool 0.8 s, chat first reply 1.8 s). A single turn over any of them is flagged in `turns.flags` (`over_p95_…`), so the dashboard (M8) can show the slow ones.

## 3. Potential holes and the tests that guard them

| What could go wrong                                                  | Guarded by                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A crafted message like `{type:"confirm", actionId}` books a table    | `connection.test.ts` › "rejects a crafted confirm message and writes nothing"                          |
| Extra fields sneak into `user_text`                                  | `connection.test.ts` › "rejects unknown fields on user_text"                                           |
| A client picks its own session id                                    | `connection.test.ts` › "never adopts an unknown client session id"                                     |
| Another website opens a socket as the visitor                        | `server.test.ts` › "refuses an upgrade from a foreign origin"                                          |
| A flood of messages stacks LLM calls                                 | `connection.test.ts` › "answers busy while a turn is in flight"                                        |
| The next message is refused right after a reply (storing still runs) | `connection.test.ts` › "accepts the next message as soon as turn_metrics arrives"                      |
| Dates come back from Redis as strings and break the re-check         | `session-store-contract.ts` › "round-trips Dates in session and pending action"                        |
| Two "yes" messages both take the pending action                      | `redis.smoke.test.ts` › "takePending is atomic under 20 concurrent calls"                              |
| A dropped connection loses the waiting read-back                     | `server.test.ts` › "resumes with ?sessionId…"; `server.smoke.test.ts` › "confirms after reconnecting…" |
| Postgres being down breaks the chat                                  | `connection.test.ts` › "a failing conversation log doesn't break the turn"                             |
| Test bookings email real people through the worker                   | `QUEUE_PREFIX`: tests and e2e queue jobs under their own prefix                                        |

## 4. Quiz

1. Why does the chat use a WebSocket instead of plain HTTP requests?
2. Who creates the session id, and what happens if the browser sends one the server doesn't know?
3. What exactly happens when the Confirm button is clicked?
4. Why is `{type:"confirm", actionId:"act_1"}` harmless?
5. Why does the server check the `Origin` header, and why is a missing `Origin` allowed?
6. Why does a second message during a turn get `busy` instead of waiting its turn?
7. Why does `codec.ts` exist, when Redis can store JSON?
8. Why does a pending action's Redis key live 60 s longer than its `expiresAt`?
9. What is the difference between p50 and p95, and when is a turn flagged?
10. What is `ScriptedLLM` for, and why do its replies never mention a time or a price?

<details>
<summary>Answers</summary>

1. One turn sends several messages over time (sentences, a read-back card, metrics), and with a WebSocket the server can push each one as it's ready.
2. The server, as a random `sess_<uuid>`. An unknown id is ignored and the browser gets a fresh one, so nobody can choose or guess their way into another conversation.
3. The browser sends the text "Yes, please" as a normal `user_text`. The gate classifies it as `confirm` and executes the pending action only if it's still current.
4. It isn't a valid client message, so the server answers `bad_message` and runs nothing. The only way to act is caller text going through the gate.
5. Browsers always send `Origin`, so the check stops a page on another site from talking to the api as its visitor. Non-browser clients (tests, scripts) send none, and they can't borrow a visitor's browser.
6. Waiting would queue LLM calls that cost money and arrive after the caller moved on. The UI also disables sending during a turn.
7. JSON has no Date type: `Booking.start` would come back as a string, and the gate's re-check compares Dates.
8. So the loop can still find an action the caller said "yes" to just after it expired, and tell them it timed out instead of acting confused.
9. p50 is the typical turn and p95 is the slow tail. A turn is flagged when any stage is over its p95 budget.
10. It lets tests and Playwright run the real loop with no API key and the same result every time. Its replies state no times or prices, so the grounding check always passes.

</details>
