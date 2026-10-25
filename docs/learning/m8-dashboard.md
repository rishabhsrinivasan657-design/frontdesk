# M8: The owner dashboard (learning guide)

M8 gives the Casa Fiorella owner a back office at `/dashboard`: Live conversations, a searchable Conversations history, Bookings, a Handoffs queue and Metrics. **Part A** added the design system, the owner login and the owner api in `apps/api`. **Part B** added the five pages in `apps/web`, the demo seed and the Playwright tests. To try it: put `OWNER_EMAIL` and a hash from `printf 'your password' | pnpm owner:hash` (in single quotes) in `.env`, then run `pnpm db:migrate && pnpm db:seed`, `pnpm api` and `pnpm web`, and open http://localhost:3000/dashboard. `pnpm db:seed --reset` refreshes the demo dates.

## 1. Reading order

| #   | File                                                                           | What it's for                                                                                           |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 1   | `design-system/front-desk/MASTER.md` → `apps/web/src/app/globals.css`          | The generated design system, and the same values as named tokens (`--primary`, `--chart-1`…).           |
| 2   | `packages/db/drizzle/0002_dashboard_columns.sql`                               | New columns: `conversations.seeded`, `turns.tool_calls`, `turns.first_output_ms`.                       |
| 3   | `packages/db/src/owner/shared.ts` + `owner/*.ts`                               | `sourceIs()`, the one place source separation lives, and the SQL behind every view (`percentile_cont`). |
| 4   | `apps/api/src/owner/plugin.ts` + `session-store.ts` + `auth.ts`                | Login, the Redis session, and the single hook that guards every `/owner` route.                         |
| 5   | `apps/api/src/owner/routes.ts` + `live.ts` + `feed.ts`                         | The REST endpoints, and the live feed (chat → `OwnerFeed` → Server-Sent Events).                        |
| 6   | `apps/web/src/proxy.ts` + `app/api/owner/[...path]/route.ts`                   | The page gate (asks the api "is this session valid?") and the same-origin pass-through to the api.      |
| 7   | `apps/web/src/app/dashboard/layout.tsx` + `components/dashboard/nav.tsx`       | The shell: sidebar, Live/Pilot switch, sign-out.                                                        |
| 8   | `apps/web/src/dashboard/live-state.ts` + `components/dashboard/live-board.tsx` | Live: a reducer applies each streamed event to the cards; reconnects resync from a snapshot.            |
| 9   | `apps/web/src/app/dashboard/{conversations,bookings,handoffs,metrics}/`        | The other four views. Server components fetch with the owner's cookie (`lib/owner-api.ts`).             |
| 10  | `apps/web/src/dashboard/latency.ts` + `components/dashboard/charts.tsx`        | Latency vs the §8 budget per turn, and the Recharts charts.                                             |
| 11  | `packages/db/src/seed.ts`                                                      | 120 demo conversations, all `live`, `seeded`, `demo_…`; idempotent, with `--reset`.                     |
| 12  | `apps/api/src/owner/auth.test.ts` + `e2e/dashboard.spec.ts`                    | Auth on every route; every view in a real browser on seeded data.                                       |

## 2. Key concepts

- **Design system and tokens.** A design system is the agreed set of colors, fonts, spacing and rules every screen uses. Tokens are those values given names, so a screen says `bg-primary` instead of `#DC2626`. Change the token and every screen follows: that's how `/talk` picked up the new look with almost no edits.
- **Session cookie auth.** A correct password gets a random 43-character id, stored in Redis for 12 hours and sent as an `HttpOnly`, `SameSite=Lax` cookie. Page JavaScript can't read it, other sites can't make the browser send it on a POST, and logout deletes it server-side. bcrypt runs even for a wrong email, so timing doesn't reveal who the owner is.
- **Defense in depth.** `proxy.ts` sends a logged-out visitor to `/login` before a page renders, but the api checks the cookie on every single call too. The page gate is for a good experience; the api check is the security.
- **Same-origin proxy.** The browser only talks to the web app (`/api/owner/*`), which forwards to the api. The cookie stays first-party and no CORS is needed. The proxy never forwards a browser's `X-Forwarded-For`, because Next.js keeps a client-supplied one and the rate limit would then trust a spoofed IP.
- **REST vs live feed.** REST is ask-and-answer ("give me the bookings"). Live needs the server to speak first, so it uses Server-Sent Events: one long response the api keeps writing `event:`/`data:` lines to. The board applies each event with a reducer, and after a reconnect it reloads the snapshot so missed events don't matter.
- **Percentiles.** p50 is the typical turn and p95 the slow tail. `percentile_cont` interpolates: for 100…1000 ms the p95 is 955. Charts show both against the §8 budget, and each stage has its own budget, so the stage view uses bullet bars instead of one shared axis.
- **Source separation.** Every conversation is `live`, `pilot` or `eval`. Eval runs use another database, the api refuses to start on it, and the owner api rejects `source=eval`. Pilot numbers also skip `seeded` rows.
- **Seeding.** Demo rows make the dashboard look real for screenshots and give Playwright known data. They're clearly marked (`seeded`, `demo_` ids, a "Demo" badge) and dated relative to now. The audit log is append-only, so a re-seed needs `--reset`, which lifts the trigger for seeded demo rows only, inside one transaction.

## 3. Potential holes and the tests that guard them

| What could go wrong                               | Guarded by                                                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new owner route forgets to check the cookie     | `auth.test.ts` › "every registered owner route rejects a missing or forged cookie"                                                                                     |
| A page renders for a logged-out visitor           | `dashboard.spec.ts` › "redirects to login and back, and signs out"                                                                                                     |
| `?next=https://evil.com` sends the owner off-site | `safe-next.test.ts` › "rejects …"                                                                                                                                      |
| Parallel password guesses slip past the limit     | `auth.test.ts` › "parallel guesses can't beat the rate limit"                                                                                                          |
| Another site posts with the owner's cookie        | `auth.test.ts` › "rejects a POST from a foreign origin", "rejects a form-encoded POST"                                                                                 |
| Eval numbers mix into live metrics                | `owner.smoke.test.ts` › "metrics never mix sources"; `routes.test.ts` › "source=eval is a 400"; e2e › "owner API is 401 without the cookie and never serves eval data" |
| Demo rows inflate pilot numbers                   | `owner.smoke.test.ts` › "pilot excludes seeded rows"; `seed.smoke.test.ts` › "writes only live seeded rows"; e2e › "pilot shows no demo data"                          |
| A reset deletes real audit records                | `seed.smoke.test.ts` › "removes only seeded demo rows, so a later seed starts fresh"                                                                                   |
| The chart's days skip or repeat around DST        | `owner.smoke.test.ts` › "daily rows are consecutive calendar days across DST"                                                                                          |
| Live misses a read-back or keeps a stale badge    | `live-state.test.ts`; e2e › "live shows a caller's session and its pending read-back"                                                                                  |

## 4. Quiz

1. Why does the server keep owner sessions in Redis instead of putting the email in a signed cookie?
2. `proxy.ts` already blocks logged-out visitors. Why does the api check the cookie again?
3. Why does the browser call `/api/owner/*` on the web app instead of the api directly?
4. Why doesn't the proxy pass the browser's `X-Forwarded-For` on to the api?
5. Why SSE for the live feed, and what does the board do after a reconnect?
6. For latencies 100, 200, …, 1000 ms, what are p50 and p95?
7. Why are tokens and cost two charts instead of one chart with two y-axes?
8. Name the guards that keep eval data out of the dashboard.
9. Seeded rows are already `source=live`. Why also `seeded=true` and `demo_` ids?
10. Why can't `pnpm db:seed` simply delete and rewrite the demo rows every time?
11. What does `safeNext("//evil.com")` return, and why?
12. Why are seeded dates relative to `FRONTDESK_NOW` in the e2e run?

<details>
<summary>Answers</summary>

1. A random id the server remembers can be revoked: logout deletes it and it expires on its own. A self-contained cookie stays valid until it expires.
2. The page gate is a convenience. Anyone can call the api directly, so the api is where security lives.
3. Same origin: the cookie is first-party, no CORS, and the live stream passes straight through.
4. Next.js keeps a client-supplied one, so anyone could claim any IP and dodge the per-IP login limit.
5. Only the server talks, so SSE is simpler than a WebSocket and carries the cookie. After a reconnect the board reloads the `/owner/live` snapshot, because events sent while it was away are gone.
6. 550 and 955. `percentile_cont` interpolates between 900 and 1000.
7. Two scales on one chart make the lines' crossing points meaningless and easy to misread (dataviz rule: one axis per chart).
8. The api won't start on the eval database, `source` only accepts `live` or `pilot`, and eval rows are never returned even if one sneaks into the main database.
9. So a mislabelled demo row still can't count under pilot, and so the UI can badge it and the reset can find exactly those rows.
10. The audit log's trigger rejects DELETE. Only `--reset` lifts it, for seeded demo rows only, in one transaction.
11. `/dashboard`. `//evil.com` is a protocol-relative URL to another site, so it falls back to home.
12. The api's clock is pinned to that moment. Dates relative to the real clock would drift out of the metrics window as real time passes.

</details>
