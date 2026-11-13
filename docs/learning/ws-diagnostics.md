# Finding where a chat socket stops

## The symptom

On Render, the chat page showed "Connecting…" and then "couldn't reach the receptionist". The
api's health check was green, and the same code on a laptop worked.

## What we learned from the outside

- A WebSocket starts as an HTTP request with `Upgrade: websocket`. The server answers
  `101 Switching Protocols`, and from then on both sides send frames.
- Render's logs showed `GET /ws … incoming request` for every attempt, and then nothing: no
  error, no reply, not even the instant `1008 origin not allowed` close.
- A deliberately broken handshake _did_ get the `ws` library's `400` back, so replies can travel
  back through Render's proxy.
- The `ws` library drops a socket **without logging** in two places: a handshake it refuses
  (unless someone listens for `wsClientError`), and a socket the other side has already
  half-closed (`!socket.readable || !socket.writable`).

## The diagnostics

`apps/api/src/server.ts` now logs, under the request's `reqId`:

- `ws request`: whether it is an upgrade, whether the socket is still readable/writable, and the
  handshake headers (never the URL, which carries the session id and bot token).
- `ws peer ended the connection`: the proxy closed its side before we answered.
- `ws handshake refused`: the reason `ws` gave, instead of a silent 400.
- `ws handler started`: our chat code actually ran.

Searching Render's logs for one `reqId` now shows exactly which step a connection reached.

## Quiz yourself

1. Why do we log the handshake headers but never the request URL?
2. If you see `ws request` and `ws peer ended the connection` but no `ws handler started`, where
   is the problem?
3. Why does listening for `wsClientError` mean we must write the 400 response ourselves?
