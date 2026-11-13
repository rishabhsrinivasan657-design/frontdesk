# Render drops close frames: say why before closing

## What we found

The live chat hung on "Connecting…". Probes on Render showed:

- Normal WebSocket messages from our api reach the browser, even one sent instantly.
- **Close frames from our api never arrive.** Render's proxy holds the browser's side open.

Our api refuses a chat by closing the socket (4429 for the chat limits, 4403 for a failed bot
check). On Render the browser never learned it was refused, so it waited forever and finally
said "couldn't reach the receptionist".

## The fix

- `refuse()` in `apps/api/src/server.ts` sends `{ type: "error", … }` with a readable message,
  _then_ closes. The page already shows any `error` message as a notice.
- The "Waking up…" note no longer hides a notice the server sent.
- `TurnstileBotCheck` logs Cloudflare's reason when it rejects a token (error codes, wrong
  hostname, HTTP status or timeout), never the token or secret.

## Quiz yourself

1. Why did a refused chat look exactly like a sleeping server?
2. Why send a normal message instead of relying on the close code and reason?
3. Which log line tells you a real visitor's bot-check token was for the wrong hostname?
