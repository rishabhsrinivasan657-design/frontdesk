# M8 Owner Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Casa Fiorella owner logs in at `/login` and runs the business from `/dashboard`: Live conversations, searchable Conversations, Bookings, a Handoffs review queue and Metrics against the latency budget. It looks like a finished product, built from the ui-ux-pro-max design system.

**Architecture:** Two PRs, never stacked. **Part A** (`claude/m8-dashboard-1802f7`): the design system (already committed), owner auth in `apps/api` (bcrypt hash from env, a random session id in Redis, an httpOnly cookie), and the owner API. The REST routes read M5's Postgres through new read functions in `@frontdesk/db`. The live feed is Server-Sent Events fed by an in-process `OwnerFeed` that `openChat` publishes to. **Part B** (branched from `main` after A merges): the Next.js pages behind a `proxy.ts` auth check. A same-origin route handler `/api/owner/[...path]` forwards to the api, so the cookie stays first-party and SSE streams through. Part B also adds the seed script, the Playwright specs and the `/talk` restyle.

**Tech Stack:** Fastify ^5 + `@fastify/cookie`, `bcryptjs` (pure JS: no native build in CI), ioredis, Drizzle, Next.js ^16 App Router (`src/proxy.ts`, which replaced `middleware.ts`), Tailwind v4 + shadcn/ui (copied components), `next/font/google`, Recharts ^3, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-frontdesk-design.md`: §10 (dashboard), §8 (per-turn record, latency budget), §6 (audit stages, handoff queue), §13, §14 M8 row. Design: `design-system/front-desk/MASTER.md` and `design-system/front-desk/pages/dashboard.md` (the page file overrides the master).

## Global Constraints

- Views (§10): **Live** (active conversations streaming + pending-action indicators), **Conversations** (searchable; transcript, tool calls, audit trail, per-turn latency), **Bookings** (agent-made, with Calendar event links), **Handoffs** (summary, transcript, resolve, notes), **Metrics** (task success, handoff rate, latency vs budget, tokens/cost per conversation over time).
- Auth (§10): one owner, `OWNER_EMAIL` + `OWNER_PASSWORD_HASH` (bcrypt) from env, httpOnly session cookie. **Every** `/dashboard` page and **every** `/owner/*` api route except `POST /owner/login` requires it.
- Source separation (§10): owner endpoints take `source=live|pilot` (default `live`). `eval` is rejected with 400, because eval data lives only in `frontdesk_eval` and the api never connects to it.
- Latency budget (§8), p50/p95 in ms: STT 400/800, LLM TTFT 700/1500, tool 300/800, TTS start 150/300, chat first token 800/1800. The p95 values already live in `apps/api/src/metrics/latency.ts` `LATENCY_P95_MS`. Add `LATENCY_P50_MS` next to them and use both as the single source.
- Audit stages (§6): `proposed → confirmed → executed | failed | voided`, plus `email_sent`/`email_failed`. `audit_log` is append-only, so the dashboard never writes to it.
- Design system: palette, fonts (Playfair Display SC headings, Karla body), spacing and the pre-delivery checklist come from `design-system/front-desk/`. Ruling: the "vibrant block" style is toned down to flat cards with 1px `--border` and no heavy shadows, so data stays readable. Density is high on dashboard pages (page override). Icons are inline SVG in one `icons.tsx`. No icon package, because ESLint ran out of memory on huge type packages before. No emoji as icons.
- New deps only: `@fastify/cookie`, `bcryptjs` (api, db seed and e2e config), `recharts` (web). shadcn components are copied files.
- Secrets: never log or print `.env` values. `.env.example` gets `OWNER_EMAIL=` and `OWNER_PASSWORD_HASH=` placeholders, plus `OWNER_SESSION_TTL_HOURS=12` and `API_URL=http://127.0.0.1:4000` for web.
- `packages/core` stays pure. Don't touch `docs/learning/m7-voice.md`.

## Rulings (recorded in the shared notes folder too)

1. **Design direction:** the user picked run 3, "Trattoria warm" (red `#DC2626`, gold `#A16207`, cream `#FEF2F2`, Playfair Display SC / Karla), over "ops console dark" and "fresh green". The skill's own files sit untracked in `.claude/skills/`. Only `design-system/` is committed.
2. **Task success** = a conversation with ≥1 `executed` audit row and no handoff. **Handoff rate** = conversations with `outcome = 'handoff'` ÷ conversations. The denominator is conversations with ≥1 turn whose `started_at` falls in the window.
3. **Seeded rows:** migration 0002 adds `conversations.seeded boolean not null default false`. The seed writes only `source='live'`, ids prefixed `demo_`, `seeded=true`. Pilot queries always add `NOT seeded`. The UI shows a "Demo" badge on seeded rows and a "Includes demo data" pill when any are in view.
4. **Eval isolation, twice over:** `buildDeps` refuses to start when `DATABASE_URL`'s database name ends in `_eval` or equals `EVAL_DATABASE_URL`'s. The owner API's `source` schema has no `eval` member.
5. **Tool calls** weren't stored before. Core's `TurnResult` gains `toolCalls: {name, ms, ok}[]` (no args, which can hold contact details; writes are in the audit trail with args). Migration 0002 adds `turns.tool_calls jsonb not null default '[]'` and `turns.first_output_ms integer`, so "chat first token" can be charted against its budget.
6. **Calendar links:** `https://www.google.com/calendar/event?eid=<base64url("<eventId> <calendarId>")>`, only when `GOOGLE_CALENDAR_ID` is set and the row isn't seeded. Otherwise `null` and the UI shows "Demo calendar".
7. **Live = this process's open sockets** (`SessionHub`), which is enough for one api process (the spec's M10 hosting is single-node).

## Review Focus

1. **A new owner route forgets the auth hook.** Expected: every `/owner/*` route but login answers 401 without a valid cookie. Pinned in A3 › "every registered owner route rejects a missing or forged cookie". It enumerates routes via `onRoute`, so a new route can't slip past.
2. **Eval or seeded rows leak into numbers.** Expected: `source=eval` gives 400. A stray `source='eval'` row in the main DB never appears under live or pilot. Seeded rows never count under pilot. Pinned in A2 › "metrics never mix sources" and "pilot excludes seeded rows".
3. **Password guessing / user enumeration.** Expected: wrong email and wrong password give the same 401 in similar time (bcrypt runs either way). The 6th failure from one IP in 15 min gets 429. Pinned in A3 › "same response for unknown email" and "rate-limits failed logins".
4. **Search input with `%`, `_` or `'`.** Expected: it matches literally and never errors. Pinned in A2 › "search treats % and _ literally".
5. **Logged-out deep link** (`/dashboard/conversations/demo_x`). Expected: redirect to `/login?next=…`, then back after login. An open-redirect `next=https://evil` falls back to `/dashboard`. Pinned in B1 › `safeNext` unit test and B6 › "redirects to login and back".

---

# Part A — design system, auth, owner API (`claude/m8-dashboard-1802f7`)

### Task A1: Record tool calls and first-output time per turn

**Files:** Modify `packages/core/src/agent/types.ts` (TurnResult), `packages/core/src/agent/loop.ts:~378`, `packages/db/src/schema.ts`, `packages/db/src/conversations.ts` (TurnRecord), `apps/api/src/metrics/turn-record.ts`. Create `packages/db/drizzle/0002_*.sql` via `drizzle-kit generate`. Tests: `packages/core/src/agent/loop.test.ts`, `apps/api/src/metrics/turn-record.test.ts`, `packages/db/src/migrate.smoke.test.ts`.

**Interfaces — Produces:** `TurnResult.toolCalls: { name: string; ms: number; ok: boolean }[]`; `TurnRecord.toolCalls`, `TurnRecord.firstOutputMs: number | null`; columns `turns.tool_calls`, `turns.first_output_ms`, `conversations.seeded`.

- [ ] Failing tests: loop › "reports each tool call's name, duration and success" (scripted check_availability → `toolCalls[0].name === "check_availability"`, `ok === true`). turn-record › "stores toolCalls and firstOutputMs" (`firstOutputMs: 812.4` → `812`). Migrate smoke › "0002 adds seeded, tool_calls, first_output_ms with defaults".
- [ ] Run, see them fail. Implement (push `{name, ms, ok: result.ok}` where `toolMs` is pushed). Generate the migration. Run `pnpm test` and `pnpm test:infra`. Commit `feat(core,db): record tool calls and first-output time per turn`.

### Task A2: Owner read model in `@frontdesk/db`

**Files:** Create `packages/db/src/owner/{conversations,bookings,handoffs,metrics}.ts`, `packages/db/src/owner/index.ts`, and `packages/db/src/owner/owner.smoke.test.ts` (infra project, real Postgres via `test-db.ts`). Modify `packages/db/src/handoff-queue.ts` (add `resolve`) and `packages/db/src/index.ts`.

**Interfaces — Produces** (`type OwnerSource = "live" | "pilot"`; every function takes `db: Db` first):
- `listConversations(db, {source, q?, before?, limit=50}) → ConversationSummary[]` `{id, source, seeded, startedAt, endedAt, outcome, handoffReason, turnCount, lastCallerText, booked: boolean, costUsd}`, newest first. `q` uses ILIKE on caller/agent text and id, with `%`, `_` and `\` escaped.
- `getConversation(db, id) → ConversationDetail | null` `{summary, turns: TurnRecord[], audit: AuditRow[], handoff: HandoffRow | null}`.
- `listBookings(db, {source}) → BookingRow[]` `{actionId, sessionId, seeded, kind, status: "booked"|"rescheduled"|"cancelled", reservationId, name, partySize, start, end, executedAt, emailed: boolean|null}`, from `executed` audit rows (`result` = core `Booking`), newest first.
- `listHandoffs(db, {source, status: "open"|"resolved"}) → HandoffRow[]`. `PgHandoffQueue.resolve(id, notes, at) → "resolved" | "not_found" | "already_resolved"`.
- `metrics(db, {source, days=30, now}) → MetricsReport` `{summary: {conversations, taskSuccessRate, handoffRate, avgTokens, avgCostUsd, latency: Record<Stage, {p50, p95}>}, daily: {day, conversations, taskSuccessRate, handoffRate, p50FirstOutputMs, p95FirstOutputMs, avgTokens, avgCostUsd}[], hasSeeded}` with `Stage = "stt"|"llmTtft"|"tool"|"ttsStart"|"firstOutput"`. Percentiles use SQL `percentile_cont`, with tools via `unnest(tool_ms)`. Days are New York calendar days (`config.business.timezone`, passed in).
- Pilot filter: `source = 'pilot' AND NOT seeded`. Every query joins audit/handoffs to `conversations` on `session_id = id` and filters by source there.

- [ ] Failing infra tests with fixed fixtures: "lists and searches conversations", "search treats % and _ literally" (`q="50%"` matches only the row with that literal text), "detail has turns, tool calls and audit trail in order", "bookings reflect the latest executed action per reservation" (book then cancel → `cancelled`), "resolve sets notes once" (second call → `already_resolved`), "metrics percentiles" (`total`/`first_output_ms` 100…1000 step 100 → p50 550, p95 955), "task success and handoff rate" (4 convs: 2 booked, 1 handoff → 0.5 / 0.25), "metrics never mix sources" (one `eval` row and one `pilot` row never appear under `live`), "pilot excludes seeded rows".
- [ ] Run, fail, implement, run `pnpm test:infra`, commit `feat(db): owner read model for the dashboard`.

### Task A3: Owner auth in the api

**Files:** Create `apps/api/src/owner/auth.ts`, `apps/api/src/owner/session-store.ts`, `apps/api/src/owner/plugin.ts` (the Fastify plugin all owner routes live in), `apps/api/src/owner/auth.test.ts`, `scripts/owner-hash.ts` (root script `owner:hash`: reads a password from stdin, prints the bcrypt hash, cost 12). Modify `apps/api/src/server.ts` (`ServerOptions.owner?: OwnerContext`), `apps/api/src/deps.ts` (Redis owner store, env, eval guard), `.env.example`, `apps/api/package.json`.

**Interfaces — Produces:**
- `interface OwnerContext { email: string; passwordHash: string; sessions: OwnerSessionStore; db: Db; feed: OwnerFeed; calendarId: string | null; timezone: string; now(): Date; secureCookie: boolean; webOrigins: string[] }`. When `OWNER_EMAIL`/`OWNER_PASSWORD_HASH` are unset, `owner` is undefined and `/owner/*` answers 503 `owner_disabled`. Chat still works.
- `OwnerSessionStore { create(): Promise<string>; valid(id): Promise<boolean>; destroy(id): Promise<void>; failures(ip): Promise<number>; recordFailure(ip): Promise<void> }`, with Redis keys `owner:sess:<id>` (TTL `OWNER_SESSION_TTL_HOURS`, default 12) and `owner:fail:<ip>` (TTL 15 min). Session id = 32 random bytes, base64url. Plus an in-memory twin for unit tests.
- Cookie `fd_owner`: `HttpOnly; SameSite=Lax; Path=/; Max-Age=TTL; Secure` when `secureCookie`.
- Routes: `POST /owner/login {email, password}` → 204 + cookie | 401 `invalid_credentials` | 429 `too_many_attempts`. `POST /owner/logout` → 204, clears the cookie and the Redis key. `GET /owner/me` → `{email}`.
- Mutations (POST) also require `content-type: application/json` and an `Origin` in `webOrigins` when present (CSRF).
- `buildDeps` throws `"DATABASE_URL points at the eval database"` when `DATABASE_URL`'s database name ends in `_eval` or matches `EVAL_DATABASE_URL`'s.

- [ ] Failing tests (`app.inject`): "logs in with the right password and sets an httpOnly cookie", "same response for unknown email" (bcrypt compare against a dummy hash), "rate-limits failed logins" (6th → 429), "every registered owner route rejects a missing or forged cookie" (collect routes under `/owner` via `onRoute`, skip login, inject each method → 401), "logout invalidates the session", "rejects a POST from a foreign origin", "owner routes answer 503 when no owner is configured", deps › "refuses to start on the eval database".
- [ ] Run, fail, implement, `pnpm verify`, commit `feat(api): owner login with bcrypt and a Redis session cookie`.

### Task A4: Owner REST routes

**Files:** Create `apps/api/src/owner/routes.ts`, `apps/api/src/owner/calendar-link.ts`, `apps/api/src/owner/routes.test.ts`. Modify `apps/api/src/owner/plugin.ts`, `apps/api/src/metrics/latency.ts` (add `LATENCY_P50_MS`).

**Interfaces — Produces** (all inside the authed plugin; Zod-validated query; `source` = `z.enum(["live","pilot"]).default("live")`):
- `GET /owner/conversations?source&q&before&limit` → `ConversationSummary[]`. `GET /owner/conversations/:id` → `ConversationDetail` | 404.
- `GET /owner/bookings?source` → `(BookingRow & {calendarUrl: string | null})[]`.
- `GET /owner/handoffs?source&status` → `HandoffRow[]`. `POST /owner/handoffs/:id/resolve {notes: string 1..2000}` → 204 | 404 | 409.
- `GET /owner/metrics?source&days` (`days` 7..90, default 30) → `MetricsReport & {budget: {p50: typeof LATENCY_P50_MS, p95: typeof LATENCY_P95_MS}}`.
- `calendarEventUrl(eventId: string, calendarId: string): string`.

- [ ] Failing tests: "source=eval is a 400", "unknown query fields are a 400", "resolve validates notes length", "metrics include the budget", calendar-link › "encodes eid as base64url of 'eventId calendarId'" (fixed vector, no padding), "bookings hide calendar links for seeded rows". Use an injected fake read model (`OwnerReads` interface wrapping A2's functions) so these stay unit tests.
- [ ] Run, fail, implement, `pnpm verify`, commit `feat(api): owner REST endpoints`.

### Task A5: Live feed (SSE)

**Files:** Create `apps/api/src/owner/feed.ts`, `apps/api/src/owner/feed.test.ts`, `apps/api/src/owner/live.ts`. Modify `apps/api/src/chat/connection.ts` (publish), `apps/api/src/chat/hub.ts` (`activeSessions(): string[]`), `apps/api/src/server.test.ts`.

**Interfaces — Produces:**
- `type LiveEvent = {type:"session_open"|"session_closed", sessionId, at} | {type:"turn", sessionId, turnIndex, callerText, agentText, firstOutputMs, flags, at} | {type:"pending", sessionId, summary, expiresAt} | {type:"pending_cleared", sessionId, status: "executed"|"failed"|"voided"} | {type:"handoff", sessionId, reason}`.
- `class OwnerFeed { publish(e: LiveEvent): void; subscribe(fn): () => void }`. A throwing subscriber never breaks the chat.
- `GET /owner/live` → `LiveSession[]` `{sessionId, startedAt, lastCallerText, lastAgentText, turnCount, pending: {summary, expiresAt} | null}`, built from `hub.activeSessions()` + `sessions.load()`.
- `GET /owner/live/stream` → `text/event-stream`. It sends `event: <type>\ndata: <json>\n\n` per `LiveEvent`, plus a `: ping` comment every 15 s. It unsubscribes on close.

- [ ] Failing tests: feed › "a throwing subscriber doesn't stop delivery", connection › "publishes turn, pending and session events" (scripted booking turn → `pending`; "yes" → `pending_cleared{executed}`), server › "live stream requires the cookie and delivers a turn event" (real listen + fetch reader).
- [ ] Run, fail, implement, `pnpm verify` + `pnpm test:infra`, commit `feat(api): live owner feed over server-sent events`.

### Task A6: Learning note (part A), review, PR

- [ ] Write `docs/learning/m8-dashboard.md` (format of `m6-chat.md`): reading order for part A, concepts (design system/tokens, session cookie auth, REST vs live feed, percentiles, source separation), holes → tests, quiz. Part B extends it.
- [ ] `pnpm verify && pnpm test:infra`. Commit. Dispatch one fresh whole-branch reviewer (most capable model): auth on every owner route, eval/seed leakage, CSRF, cookie flags. Fix pass. Then superpowers:finishing-a-development-branch: push, PR to `main`, bind with ccd_pr, offer Auto-fix.

---

# Part B — the five views, seed, Playwright (new branch from `main` after A merges)

### Task B1: Theme, fonts, shell, auth gate, proxy

**Files:** Modify `apps/web/src/app/globals.css` (tokens from MASTER.md as `--background` etc. in hex, `--accent`, `--success #15803D`, `--warning #B45309`, chart `--chart-1..5` from palette), `apps/web/src/app/layout.tsx` (`next/font/google` Playfair_Display_SC + Karla as `--font-heading`/`--font-sans`), `apps/web/package.json`. Create `apps/web/src/proxy.ts`, `apps/web/src/app/api/owner/[...path]/route.ts`, `apps/web/src/lib/owner-api.ts`, `apps/web/src/lib/safe-next.ts` (+ `.test.ts`), `apps/web/src/app/login/page.tsx`, `apps/web/src/app/dashboard/layout.tsx` (sidebar: Live, Conversations, Bookings, Handoffs, Metrics; source switcher `?source=live|pilot`; "Includes demo data" pill; logout), `apps/web/src/components/icons.tsx`, and the shadcn components needed: `table, tabs, select, textarea, skeleton, separator, sheet, tooltip, label`.

**Interfaces — Produces:** `ownerFetch<T>(path: string, init?): Promise<T>` (server components: forwards the `fd_owner` cookie to `API_URL`, redirects to `/login` on 401). `safeNext(next: string | null): string` (only same-site paths starting with `/dashboard`). `proxy.ts` matcher `/dashboard/:path*`: no cookie, or `GET API_URL/owner/me` ≠ 200 → `/login?next=<path>`. The route handler forwards method, body, `cookie`, `origin`, `content-type`, streams the response body back, and passes `set-cookie` through.

- [ ] Failing unit test `safe-next.test.ts` (`"https://evil.com"`, `"//evil.com"`, `"/talk"` → `/dashboard`; `"/dashboard/bookings?source=pilot"` kept). Implement. Check the shell against the design checklist (focus rings, 4.5:1 contrast, cursor-pointer, reduced motion, 375/768/1024/1440). Commit.

### Task B2: Live view

**Files:** `apps/web/src/app/dashboard/page.tsx` (Live is the dashboard home), `apps/web/src/components/dashboard/live-board.tsx` (client: initial `GET /api/owner/live`, then `EventSource('/api/owner/live/stream')`, reducer `applyLiveEvent(state, e)` in `apps/web/src/dashboard/live-state.ts` + test).

Cards per active session: last exchange, turn count, a pulsing "Awaiting confirmation" badge with the summary and an expiry countdown while pending, a handoff badge, and a "Connected/Reconnecting" indicator. Empty state: "No one is talking to Front Desk right now" + a link to `/talk`.

- [ ] Failing `live-state.test.ts`: "pending then pending_cleared clears the badge", "session_closed removes the card", "turn updates the last exchange". Implement. Commit.

### Task B3: Conversations

**Files:** `apps/web/src/app/dashboard/conversations/page.tsx` (search box → `?q=`, table with source/Demo badges, outcome chips, "Load older" via `before`), `apps/web/src/app/dashboard/conversations/[id]/page.tsx` (transcript as chat bubbles; per turn a latency strip of first output / LLM TTFT / tools / STT / TTS, colored red over p95 with a tooltip naming the budget; tool-call chips; an audit timeline `proposed → confirmed → executed` with args), `apps/web/src/components/dashboard/latency-strip.tsx`.

- [ ] Failing unit test `latency-strip` helper `stageStatus(ms, stage) → "ok"|"warn"|"over"` (warn > p50, over > p95, equal is within). Implement. Commit.

### Task B4: Bookings and Handoffs

**Files:** `apps/web/src/app/dashboard/bookings/page.tsx` (table: guest, party, date/time in the business timezone, status chip, "Open in Calendar" link or "Demo calendar", link to its conversation), `apps/web/src/app/dashboard/handoffs/page.tsx` (Open/Resolved tabs; each ticket a card with reason, summary, collapsible transcript; resolve form = textarea + button, client component POSTing to `/api/owner/handoffs/:id/resolve`, then `router.refresh()`).

- [ ] Commit (covered by the B6 Playwright tests).

### Task B5: Metrics, seed

**Files:** `apps/web/src/app/dashboard/metrics/page.tsx`, `apps/web/src/components/dashboard/charts/*.tsx` (Recharts, client). KPI cards: conversations, task success, handoff rate, avg cost/conversation. Charts: success and handoff rate over time (line), first-output p50/p95 per day with dashed budget reference lines at 800/1800 (line + `ReferenceLine`), a per-stage p50/p95 vs budget bar chart, tokens and cost per conversation per day (bar + line, dual axis). Range select 7/30/90 days. Colors from `--chart-*`. Each chart has an `aria-label` and an sr-only table.
`packages/db/src/seed.ts` + root script `db:seed`: a deterministic PRNG, 48 conversations over the last 21 days (relative to now), ids `demo_<n>`, `source='live'`, `seeded=true`. Realistic latencies (log-normal around the budget p50s, ~8% over p95), 2–7 turns, tool calls, audit trails (≈60% booked, some voided, a few failed `slot_taken`), 6 handoffs (4 open, 2 resolved with notes). Insert with `onConflictDoNothing` and write audit rows only for newly inserted conversations (audit is append-only), so re-runs are no-ops. It refuses a database whose name ends in `_eval`.

- [ ] Failing infra test `seed.smoke.test.ts`: "seed is idempotent", "writes only live seeded rows" (`count(*) where source <> 'live' or not seeded and id like 'demo_%'` = 0), "refuses the eval database". Implement. Run `pnpm db:seed` locally and screenshot every view in the browser pane at 1440 and 375. Commit.

### Task B6: Playwright, `/talk` restyle, learning note, PR

**Files:** Create `e2e/dashboard.spec.ts`, `e2e/global-setup.ts` (runs the seed). Modify `e2e/playwright.config.ts` (api env `OWNER_EMAIL=owner@casafiorella.test`, `OWNER_PASSWORD_HASH=bcryptjs.hashSync(E2E_OWNER_PASSWORD, 4)` computed at load from a constant in `e2e/helpers.ts`; web env `API_URL=http://127.0.0.1:4100`), `apps/web/src/app/talk/page.tsx` + `components/chat/*` (tokens, fonts, Casa Fiorella header; no behavior change, the existing talk/voice specs must pass), `docs/learning/m8-dashboard.md`.

- [ ] Specs: "redirects to login and back" (each of the 5 routes logged out → `/login?next=`, log in → lands on the deep link), "rejects a wrong password", "owner API is 401 without the cookie" (`request.get('/api/owner/metrics')`), "live shows a caller's session and pending badge" (second page books at `/talk` → card + "Awaiting confirmation"; confirm → badge clears), "conversations search opens a transcript with tool calls, audit trail and latency", "bookings list seeded reservations", "handoff resolve with a note moves it to Resolved", "metrics show KPIs and charts" (4 KPI cards, ≥4 `svg.recharts-surface`), "pilot shows no demo data" (`?source=pilot` → empty states).
- [ ] `pnpm verify && pnpm test:infra && pnpm e2e`. Finish the learning note (reading order, concepts incl. seeding, holes → tests, 8–12 quiz Qs in `<details>`, 1–2 pages). Whole-branch review, fix pass, finishing-a-development-branch, PR, bind, offer Auto-fix.
