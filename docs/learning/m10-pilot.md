# M10: The pilot (learning guide)

M10 puts Front Desk in front of strangers. **Part A** (PR #24) makes the code safe for that:

- a production guard that keeps it at $0
- pilot tagging
- a feedback log and handoff outcomes
- abuse limits (rate limits, a bot check, booking and email caps)
- a 30-day retention job
- a deep health check
- a privacy notice
- `pnpm release`

**Part B** puts it online:

- a Dockerfile and a production Compose file with Caddy for HTTPS, on an Oracle Always Free VM
- `pnpm smoke <url>`
- a 6-hourly health check on GitHub
- the runbooks `docs/deploy.md` (setup) and `docs/pilot.md` (the weekly routine)

To try Part A locally:

1. Run `pnpm infra:up && pnpm db:migrate`, `pnpm api` and `pnpm web`.
2. Open http://localhost:3000/talk, chat, click **End chat** and rate it.
3. See the rating at `/dashboard/feedback`.
4. Set `CHAT_LIMITS=on` to try the limits.

## 1. Reading order

| #   | File                                                                        | What it's for                                                                                                       |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/worker/src/pilot-guard.ts`                                            | `assertPilotSafe`: production refuses to start on paid or unsafe settings. `readConversationSource`.                |
| 2   | `packages/db/drizzle/0003_pilot.sql`, `0004_retention_reason.sql`           | Feedback (one per conversation), `handoffs.outcome`, `pii_purged_at`, and the audit trigger's one narrow exception. |
| 3   | `apps/api/src/chat/connection.ts` (`onFeedback`, `allowTurn`)               | Where feedback is saved and where a turn over the limit is refused.                                                 |
| 4   | `apps/api/src/abuse/window-counter.ts` + `chat-limits.ts`                   | Fixed-window counters in Redis (`INCR` + `PEXPIRE NX`); the per-IP and per-session limits.                          |
| 5   | `apps/api/src/abuse/bot-check.ts` + `server.ts` (`mayResume`)               | Turnstile's `siteverify`, and who needs a token (new sessions) and who doesn't (resumes).                           |
| 6   | `packages/core/src/ports/booking-quota.ts` + `gate/propose.ts`/`execute.ts` | Two online bookings per contact per day: checked at propose, counted after Calendar says yes.                       |
| 7   | `apps/worker/src/email-quota.ts` + `process-confirmation.ts`                | 3 emails per address and 50 in total per day; over the cap the email is skipped, never retried.                     |
| 8   | `packages/db/src/retention.ts` + `apps/worker/src/retention-job.ts`         | Redacting pilot data after 30 days, daily at 04:00 New York.                                                        |
| 9   | `apps/api/src/health.ts` + `integrations/src/google/token-check.ts`         | `/health/ready`: Redis, Postgres, the Google refresh token, the worker heartbeat. ok/fail only.                     |
| 10  | `apps/web/src/app/talk/page.tsx`, `app/privacy/page.tsx`                    | The privacy notice and page.                                                                                        |
| 11  | `apps/web/src/chat/turnstile.ts` + `use-turnstile.ts` + `socket.ts`         | One token per new session; reconnects reuse the session id; 4429/4403 stop the reconnect loop.                      |
| 12  | `scripts/release-lib.ts` + `release.ts`                                     | `vYYYY.MM.DD` tags and the CHANGELOG section. Never pushes.                                                         |
| 13  | `Dockerfile` + `.dockerignore`                                              | One image per role (app, web), built on the VM; env files never enter an image.                                     |
| 14  | `deploy/compose.prod.yml` + `Caddyfile`                                     | The stack: only Caddy has ports; fixed addresses for Caddy and web, which the api trusts for `X-Forwarded-For`.     |
| 15  | `deploy/deploy.sh`, `backup.sh`, `.env.production.example`                  | Deploy a tag (refuses an env file that isn't `chmod 600`), nightly backups, every setting explained.                |
| 16  | `scripts/smoke-lib.ts` + `.github/workflows/pilot-health.yml`               | Outside checks without spending quota; the 6-hourly alert.                                                          |
| 17  | `docs/deploy.md`, `docs/pilot.md`                                           | Click-by-click setup; the weekly routine and real-vs-simulated metrics.                                             |

## 2. Key concepts

- **Deployment.** Running the same code on a machine the public can reach, with production settings (`NODE_ENV=production`), real secrets in a locked-down env file, and the database and Redis hidden from the internet. Here that machine is an Oracle Always Free VM (Part B).
- **Reverse proxy + HTTPS.** Caddy is the only thing listening on ports 80/443. It gets a free Let's Encrypt certificate for the DuckDNS name, decrypts HTTPS and forwards `/ws` and `/health` to the api and everything else to the web app. It also sets `X-Forwarded-For` to the real visitor address, which is why the api trusts that header only from the proxy's network (`TRUST_PROXY`).
- **Rate limiting.** A fixed window counts hits per key: the first hit sets a TTL, so the count resets when the window ends. The pilot limits:
  - **per IP:** 10 new chats an hour, 3 open at once, 60 turns a day
  - **per chat:** 8 turns a minute, 40 in total for its whole life
  - **for everyone together:** 200 turns a day

  A turn can make 2 model calls, so one IP stays under a quarter of the free tier's 500 requests a day and everyone together stays under all of it. An IPv6 address counts by its /64, because one machine can own a whole /64. Keys are HMACs with a server secret (`KEY_HASH_SECRET`): a plain hash of an IPv4 address can be reversed by hashing all 4 billion of them.

- **Abuse vectors.** Things a stranger could do with a public endpoint:
  - burn the LLM quota (blocked by the rate limits, the daily budget and Turnstile)
  - use the confirmation email to spam someone (blocked by the email caps, which count `a+1@` and `a+2@` as one inbox)
  - fill the calendar (blocked by 2 bookings per contact per day and 2 per chat)
  - guess the owner password (the per-IP login limit, now fed the real IP, plus a ceiling of 50 attempts an hour from everywhere)
- **Bot check.** Turnstile gives the browser a one-time token. The api asks Cloudflare whether it's genuine before opening a new session. Resuming a stored session needs no token, because its id is already an unguessable credential.
- **PII and retention.** PII is anything that identifies a person: names, phones, emails, and what they typed. Logs never carry it (tested). After 30 days the pilot's PII is _redacted_, not deleted: counts, outcomes, ratings and latencies survive, so the metrics still add up. The audit log stays append-only, except for one flag-guarded UPDATE that may only touch `args`, `result` and `reason`.
- **OAuth publishing.** In Google's "Testing" mode a refresh token dies after 7 days. Publishing the app to "In production" (unverified, used by one account) keeps it alive. `/health/ready` checks it with a fresh client every 5 minutes, so a dead token fails loudly.
- **Release tags + changelog.** A tag names one exact commit (`v2026.11.02`), so "what's deployed?" has a precise answer, and a rollback is "deploy the previous tag". The changelog is generated from conventional commit subjects since the last tag.
- **Real vs simulated metrics.** Evals run scripted callers against recordings (`source=eval`, its own database). The pilot records real people under `source=pilot`. A handoff the owner marks "wasn't needed" is the real-world twin of the eval's "unnecessary handoff". Comparing the two shows where the simulator is too kind.

- **Containers and Compose.** An image is the app plus everything it needs, frozen. A container is a running copy of it. Compose starts the whole set (Caddy, web, api, worker, Postgres, Redis) on a private network, in order: migrations must finish before the api and worker start.

## 3. Potential holes and the tests that guard them

| What could go wrong | Guarded by |
| Postgres or Redis exposed to the internet | `deploy-config.smoke.test.ts` › "publishes only Caddy's 80 and 443" |
| A spoofable proxy range in production | `pilot-guard.test.ts` › "refuses TRUST_PROXY…"; `deploy-config.smoke.test.ts` › "the api trusts only Caddy's…" |
| A secret baked into an image or the example env | `deploy-config.smoke.test.ts` › "the image never copies an env file", "the example env file has only placeholders" |

| The site is down or half-broken after a deploy          | `smoke-lib.test.ts` (and `pnpm smoke <url>` after every deploy)                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Production starts with a paid tier or the bot check off | `pilot-guard.test.ts` › "refuses %s, naming it but never its value"                                            |
| A spoofed `X-Forwarded-For` dodges the per-IP limits    | `server.test.ts` › "ignores X-Forwarded-For from an untrusted peer"                                            |
| A made-up session id skips the bot check                | `server.test.ts` › "unknown sessionId without a token is refused"                                              |
| Token-free reconnects chain forever                     | `server.test.ts` › "a verified session reconnects once before its first turn, then needs a token"              |
| `A@x.com` vs `a@x.com ` dodges a cap                    | `propose.test.ts` › "counts ' A@x.com ' and 'a@x.com' as one contact"; `email-quota.test.ts` › "ignores case"  |
| A capped email is retried or opens a handoff            | `process-confirmation.test.ts` › "51st email overall is skipped, without throwing so it is never retried"      |
| Retention touches live, seeded or recent rows           | `retention.smoke.test.ts` › "leaves live, seeded and recent rows untouched"                                    |
| Retention breaks the metrics                            | `retention.smoke.test.ts` › "keeps counts, ratings, outcomes and latencies"                                    |
| The audit log becomes editable                          | `audit-append-only.smoke.test.ts` › "…without the retention flag is rejected", "…changes stage is rejected"    |
| A name, email or session id lands in a log              | `no-pii-logs.test.ts`; `process-confirmation.test.ts` › "a lost handoff and a failed audit log neither names…" |
| The health check leaks a token or hammers Google        | `health.test.ts` › "never includes error text", "caches the google check for 5 minutes"                        |
| A reconnect loop burns the limits                       | `socket.test.ts` › "stops on close code %i without reconnecting"                                               |

## 4. Quiz

1. Why does production refuse to start when `SPEND_CAP_USD_MONTHLY` is not `0`, instead of trusting the free tier?
2. Why does the api trust `X-Forwarded-For` only from `TRUST_PROXY`, and what breaks if it trusted everyone?
3. A resumed session needs no Turnstile token. Why is that safe?
4. Why is the booking cap checked at propose but counted only after Calendar accepts the booking?
5. Why does a capped email return instead of throwing?
6. Why redact old pilot data instead of deleting the rows?
7. The audit log is append-only. How can the retention job change it, and what stops anyone else doing the same?
8. Why does the Google check build a new OAuth client every time?
9. What does publishing the OAuth app to "In production" fix?
10. Why does `pnpm release` never push?
11. What do "Handoff wasn't needed" outcomes tell you when you compare the pilot with the evals?
12. Why does only Caddy publish ports, and why does the api trust two fixed addresses instead of the whole Docker network?

<details>
<summary>Answers</summary>

1. Code can't see whether billing is on in Google's console. A cap of 0 makes any paid call fail closed, so a misconfigured key can't cost money.
2. Only Caddy sets that header truthfully. If any client were trusted, anyone could claim a new IP on every request and never hit the per-IP limits.
3. The session id is a long random credential the server issued after a bot check, so knowing it already proves the caller passed one. A made-up id isn't found, so it needs a token.
4. A refusal before the read-back is the clearest message for the caller, and a booking that failed shouldn't use up the allowance.
5. Throwing would make BullMQ retry it, and the final retry would open a handoff. A cap is a decision, not a failure.
6. So counts, outcomes, ratings and latencies still add up in the metrics after the personal details are gone.
7. One `UPDATE` is allowed inside a transaction that sets `frontdesk.retention = 'on'`, and only if every column except `args`, `result` and `reason` is unchanged. DELETE and TRUNCATE are always rejected.
8. A client caches its access token for up to an hour, which would hide a refresh token that has already been revoked or has expired.
9. In Testing mode refresh tokens expire after 7 days, so the bot would stop booking weekly until someone re-authorised it.
10. Pushing a tag is outward-facing and permanent. The script prepares it, and you decide when it goes public.
11. They count unnecessary handoffs from real callers. If that share is much higher than the eval's "unnecessary handoff" count, the scenarios are missing something real callers do.
12. Every other service stays unreachable from the internet. Connections that arrive through a published port can appear to come from the Docker gateway, so trusting the whole subnet would let anyone claim any address and dodge the limits.

</details>
