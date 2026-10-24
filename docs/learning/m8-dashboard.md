# M8: The owner dashboard (learning guide)

M8 gives the Casa Fiorella owner a back office at `/dashboard`: Live conversations, a searchable Conversations history, Bookings, a Handoffs queue and Metrics. It ships in two PRs. **Part A** (this note so far) adds the design system, the owner login and the owner api in `apps/api`. **Part B** adds the pages, the demo seed and the Playwright tests, and extends this note. To try Part A: put `OWNER_EMAIL` and a hash from `printf 'your password' | pnpm owner:hash` (in single quotes) in `.env`, run `pnpm db:migrate`, then `pnpm api`, and `curl -i -X POST localhost:4000/owner/login -H 'content-type: application/json' -d '{"email":"…","password":"…"}'`.

## 1. Reading order

| #   | File                                                                           | What it's for                                                                                                           |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | `design-system/front-desk/MASTER.md` + `pages/dashboard.md`                    | The generated design system: colors, fonts, spacing, checklist. The page file overrides the master for dashboard pages. |
| 2   | `packages/db/drizzle/0002_dashboard_columns.sql`                               | Three new columns: `conversations.seeded`, `turns.tool_calls`, `turns.first_output_ms`.                                 |
| 3   | `packages/core/src/agent/loop.ts` (`toolCalls`)                                | Each turn now reports which tools ran, how long each took and whether it worked (no arguments: they can hold contacts). |
| 4   | `packages/db/src/owner/shared.ts`                                              | `sourceIs()` (the one place source separation lives) and `containsPattern()` (literal search).                          |
| 5   | `packages/db/src/owner/{conversations,bookings,handoffs,metrics}.ts`           | The read model: plain SQL the dashboard needs, including `percentile_cont` for p50/p95.                                 |
| 6   | `apps/api/src/owner/session-store.ts` + `auth.ts`                              | Random session ids in Redis, failed-login counting, bcrypt checking that costs the same for a wrong email.              |
| 7   | `apps/api/src/owner/plugin.ts`                                                 | Everything under `/owner`: one `onRequest` hook checks the cookie (and CSRF) for every route but login.                 |
| 8   | `apps/api/src/owner/routes.ts` + `reads.ts`                                    | The REST endpoints with strict Zod queries; `OwnerReads` lets tests swap Postgres for fakes.                            |
| 9   | `apps/api/src/owner/feed.ts` + `live.ts` + `chat/connection.ts`                | The live feed: the chat publishes events, `/owner/live/stream` sends them as Server-Sent Events.                        |
| 10  | `apps/api/src/deps.ts`                                                         | Reads the owner env, refuses the eval database, wires the routes.                                                       |
| 11  | `apps/api/src/owner/auth.test.ts`, `packages/db/src/owner/owner.smoke.test.ts` | The behavior: auth on every route, and the SQL against real Postgres.                                                   |

## 2. Key concepts

- **Design system and tokens.** A design system is the agreed set of colors, fonts, spacing and rules every screen uses. Tokens are those values given names (`--primary`, `--border`), so a screen says "primary" instead of `#DC2626`. Change the token and every screen follows. We generated ours with the ui-ux-pro-max skill and you picked the warm "trattoria" direction.
- **Session cookie auth.** After a correct password, the server makes a random 43-character id, stores it in Redis with a 12-hour expiry, and sends it as a cookie. `HttpOnly` means page JavaScript can't read it, so an XSS bug can't steal it. `SameSite=Lax` means other sites can't make the browser send it on a POST. Because the id lives in Redis, logout really ends the session.
- **bcrypt.** A slow, salted password hash. The env holds only the hash, so a leaked `.env` doesn't reveal the password. We run bcrypt even when the email is wrong, so response time doesn't tell an attacker which emails exist.
- **CSRF.** Cross-site request forgery: another site makes your browser send a request to ours. Owner POSTs must be JSON from an allowed origin, and an HTML form can't send JSON.
- **REST vs live feed.** REST is ask-and-answer: "give me the bookings". Live needs the server to speak first when a caller says something. We use Server-Sent Events (SSE): one long HTTP response the server keeps writing `event:`/`data:` lines to. It's simpler than a WebSocket when only the server talks, and the cookie rides along like any request.
- **Percentiles.** p50 is the middle value (half the turns are faster), p95 the slow tail (19 of 20 are faster). Postgres `percentile_cont` interpolates between values: for 100…1000 ms the p95 is 955. We chart both against the spec §8 budget.
- **Source separation.** Every conversation is `live`, `pilot` or `eval`. Eval runs write to a different database (`frontdesk_eval`). The api refuses to start pointed at it, and the owner api doesn't accept `source=eval`. Pilot numbers also skip `seeded` demo rows.

## 3. Potential holes and the tests that guard them

| What could go wrong                                         | Guarded by                                                                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new owner route forgets to check the cookie               | `auth.test.ts` › "every registered owner route rejects a missing or forged cookie"                                                                       |
| Guessing emails by timing or by different error messages    | `auth.test.ts` › "same response for unknown email"                                                                                                       |
| Password guessing                                           | `auth.test.ts` › "rate-limits failed logins"                                                                                                             |
| Logout leaves the cookie working                            | `auth.test.ts` › "logout invalidates the session"                                                                                                        |
| Another site posts to the owner api with the owner's cookie | `auth.test.ts` › "rejects a POST from a foreign origin", "rejects a form-encoded POST"                                                                   |
| Eval numbers mix into live metrics                          | `owner.smoke.test.ts` › "metrics never mix sources"; `routes.test.ts` › "source=eval is a 400"; `deps.test.ts` › "refuses to start on the eval database" |
| Demo rows inflate pilot numbers                             | `owner.smoke.test.ts` › "pilot excludes seeded rows; live flags them"                                                                                    |
| Searching `50%` matches everything                          | `owner.smoke.test.ts` › "search treats % and _ literally"                                                                                                |
| A cancelled booking still shows as booked                   | `owner.smoke.test.ts` › "reflect the latest executed action per reservation"                                                                             |
| A broken owner stream breaks a caller's turn                | `feed.test.ts` › "a throwing subscriber doesn't stop delivery"                                                                                           |

## 4. Quiz

1. Why does the server keep owner sessions in Redis instead of putting the email in a signed cookie?
2. What does `HttpOnly` protect against, and what does `SameSite=Lax` protect against?
3. Why does login run bcrypt even when the email is wrong?
4. Why is the auth check one `onRequest` hook instead of a line in each route?
5. How does requiring `content-type: application/json` stop CSRF?
6. Why SSE for the live feed instead of polling `/owner/live` every second?
7. For turn latencies 100, 200, …, 1000 ms, what are p50 and p95, and why isn't p95 1000?
8. Name the two separate guards that keep eval data out of the dashboard.
9. Why does the seeded flag exist when seeded rows are already `source=live`?
10. Why does `turns.tool_calls` store tool names and durations but not their arguments?

<details>
<summary>Answers</summary>

1. A random id the server remembers can be revoked: logout deletes it and it expires on its own. A self-contained cookie stays valid until it expires, even after logout.
2. `HttpOnly`: JavaScript on the page (for example an injected script) can't read the cookie. `SameSite=Lax`: the browser won't send it on a POST started by another site.
3. So a wrong email takes as long as a wrong password. Otherwise the fast answer would reveal which emails aren't the owner's.
4. So a route added later can't forget it. The hook also runs for unknown paths, and the guard test lists every registered route and checks each one.
5. A cross-site HTML form can only send form-encoded or plain-text bodies. Sending JSON cross-site needs a CORS preflight, which our api doesn't grant.
6. The owner sees a reply the moment it's sent, and nothing runs while nobody is talking. Polling would be late and keep hitting Redis.
7. p50 is 550 and p95 is 955. `percentile_cont` interpolates: 95% of the way through ten values falls between 900 and 1000.
8. The api refuses to start if `DATABASE_URL` is the eval database, and the owner api's `source` only accepts `live` or `pilot`.
9. Belt and braces: pilot queries also say `not seeded`, so a mislabelled demo row can never count. The flag also lets the UI show a "Demo" badge.
10. Arguments include names and phone numbers or emails. The audit log already records the arguments of actual writes, which is what the owner needs to review.

</details>
