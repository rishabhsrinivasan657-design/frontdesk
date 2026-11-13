# Every visitor looked like Render

## The bug

The api allows 10 new chats per hour **per visitor address**. Behind Render, the address the
api sees is Render's proxy, so every visitor in the world shared those 10 chats. A day of
testing used them up, and real visitors were refused ("Too many chats from your network").

## Why not just trust X-Forwarded-For?

The proxy writes the visitor's address into `X-Forwarded-For`. But a client can write that
header too. Trusting it from anyone would let a bot pick a new address per request and skip
every limit.

- Behind Caddy we know the proxy's exact address, so `TRUST_PROXY` lists it.
- Render's proxy address changes, and Fastify (on purpose) ignores a plain hop count.

## The fix

`TRUST_PRIVATE_PROXY=1` (`apps/api/src/trust-proxy.ts`) trusts exactly **one hop**, and only
when the direct peer is on a **private network** (10.x, 172.16–31.x, 192.168.x, 100.64.x):
that can only be Render's own proxy. The api then uses the address Render added. A visitor
connecting from the internet is never trusted, so its header is ignored. `render.yaml` sets
it, and the pilot guard only allows `1` or unset.

## Quiz yourself

1. Why did one person's testing lock out every other visitor?
2. Why is "trust only if the direct peer is private" safe, but "trust everyone" isn't?
3. Which entry of `X-Forwarded-For: a, b` does the api use with one trusted hop, and why?
