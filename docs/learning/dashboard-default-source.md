# Why the dashboard looked empty on Render

## The symptom

On the live site, every dashboard page (Today, Conversations, Bookings, Metrics, Feedback)
was empty, even right after a real booking.

## The cause

Two settings that each made sense on their own:

- The api on Render runs with `CONVERSATION_SOURCE=pilot`. Production *requires* it (pilot-guard),
  so real guests are never mixed with demo or test chats. Every conversation is saved as **pilot**.
- The dashboard opened on **Live** unless the link said `?source=pilot`.

So the data was there all along; the dashboard was looking at the other data set.

## The fix

- `apps/web/src/dashboard/source.ts` holds the rule in one place:
  - `DEFAULT_SOURCE` comes from `NEXT_PUBLIC_DASHBOARD_SOURCE` (`pilot` or `live`, default `live`).
  - `sourceParam()` reads `?source=`, falling back to that default.
  - `sourceQuery()` builds the `?source=…` a link needs; for the default it is empty.
- Every page, the side nav and the Live/Pilot switch use those helpers instead of checking
  `=== "pilot"` themselves. With Pilot as the default, the Live button links to `?source=live`.
- `render.yaml` and `deploy/compose.prod.yml` set `NEXT_PUBLIC_DASHBOARD_SOURCE=pilot`. The
  `Dockerfile` passes it as a build arg, because `NEXT_PUBLIC_*` values are baked into the
  browser bundle at build time, not read when the server starts.

Locally nothing changes: the variable is unset, so the dashboard still opens on Live.

## Quiz yourself

1. Why does a `NEXT_PUBLIC_*` variable have to be a Docker *build* arg, not just a runtime env var?
2. With Pilot as the default, what URL does the Live button point to, and why can't it just drop
   `?source=` like before?
3. Why do the api calls (e.g. `/handoffs?source=pilot`) still check `source === "pilot"` directly?
