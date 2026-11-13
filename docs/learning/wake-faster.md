# Waking up faster on Render's free plan

## The problem

After about 15 minutes without visitors, the page sat on "Connecting…" for a minute or two.

Render's free plan puts each service to sleep after 15 idle minutes, and the next request
wakes it. We have two services, and they used to wake **one after the other**:

1. The guest opens the page. Render wakes the web service (about 30–60 s).
2. The page loads and opens the chat socket. Only that reaches the api, so the api starts
   waking now (another 30–60 s: container start, migrations, worker).

## The fix

Ping the api's `/health` as early as possible, so both wake at the same time.

- `apps/web/src/instrumentation.ts`: Next.js runs `register()` once when the web server starts.
  On Render that happens because a visitor just woke it, so it pings `API_URL/health` right
  away, before the page has even finished loading.
- `apps/web/src/chat/wake.ts`: `wakeApi()` is a fire-and-forget ping that never throws.
  The chat window also calls it when the page loads, for the case where the web service was
  awake but the api had gone to sleep. `no-cors` is fine: we never read the answer, the request
  only has to arrive.
- `wakingUp()` decides when to explain the wait. After 3 s without a connection, the header
  says "Waking up…" and a note says the free server takes about a minute. This also replaces
  the "couldn't reach" message for the first 2 minutes, because during a cold start the socket
  can give up before the api is ready (it keeps retrying anyway).

## What it can't fix

A cold start still takes time; this only stops the two waits from adding up. Keeping the
services awake would need an outside pinger, but two services running all month use more
than the plan's 750 free hours. So before a demo, open the site a couple of minutes early.

## Quiz yourself

1. Why does pinging from `register()` help more than pinging from the page?
2. Why is it fine to use `mode: "no-cors"` for the ping, even though we can't read the reply?
3. Why does the waking note hide "We couldn't reach the receptionist" only for the first 2 minutes?
