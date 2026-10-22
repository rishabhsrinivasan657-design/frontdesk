# M5 Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Front Desk's actions real: Postgres persistence with an append-only audit log, a BullMQ worker that sends confirmation emails with retries, and Google Calendar + Gmail adapters behind core's existing `Calendar` and `Mailer` interfaces.

**Architecture:** Two PRs, never stacked. **Part A** (`m5-integrations-a`): `packages/db` (Drizzle schema, migrations, trigger, Postgres adapters) and `apps/worker` (BullMQ queue, typed enqueue, `QueueMailer`, job processor). Tested with in-memory mailers and real Docker Postgres/Redis. **Part B** (`m5-integrations-b`, branched from `main` after A merges): `packages/integrations` (Google Calendar + Gmail adapters, OAuth helper script, shared contract tests that run live only with credentials).

**Tech Stack:** Node 24, TypeScript ^5, Vitest, `drizzle-orm` ^0.45 + `drizzle-kit` ^0.31 on `pg`, `bullmq` ^6 on `ioredis`, `googleapis` ^187 + `google-auth-library` ^11, `tsx` for scripts.

**Spec:** `docs/superpowers/specs/2026-10-22-frontdesk-design.md` (§3, §5, §6, §8, §10, §11, §13, §14 M5 row).

## Global Constraints

- Google Calendar is the **only** source of truth for reservations; Postgres never stores a booking copy (§3).
- Reservation details live in the event's `extendedProperties.private` (§5).
- `audit_log` is append-only: a DB trigger rejects UPDATE and DELETE (§6). This plan also rejects TRUNCATE.
- Audit stages: `proposed → confirmed → executed | failed | voided` (§6), plus `email_sent | email_failed` for worker attempts (this plan).
- Per-turn record columns: `stt_ms, llm_ttft_ms, llm_total_ms, tool_ms[], tts_start_ms, total_ms, tokens_in, tokens_out, cost_usd` (§8).
- Every conversation has `source: live | pilot | eval`; eval runs use a separate database `frontdesk_eval` (§10). Migrations run against both.
- Gmail send fails → retry with backoff, **5 attempts**, each audited; booking stands; repeated failure → handoff queue (§11).
- Calendar unreachable → adapter throws `CalendarUnavailableError` (core's gate already hands off on it) (§11).
- Contract tests are shared between in-memory and real adapters; real ones run only with credentials and are skipped in CI (§13).
- `packages/core` stays lint-enforced pure; adapters live in `db`, `integrations`, `worker`.
- `tests/lint/workspace-references.test.ts`: every `workspace:*` dep needs a matching tsconfig reference.
- Secrets (`GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`) live only in the git-ignored `.env`. Never logged, printed, committed, or included in an error message. OAuth scopes: exactly `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/gmail.send`.
- The real Calendar adapter refuses `GOOGLE_CALENDAR_ID=primary`; it must point at the dedicated "Casa Fiorella (demo)" calendar.
- Live contract tests delete every event they create, even when an assertion fails.

## Review Focus

1. **A Google error leaks a token.** `GaxiosError` carries the request config, including the `Authorization: Bearer …` header. Adapters must rethrow a fresh error built from status and reason only. Pinned by B1 `google-errors.test.ts` › "never includes request headers or tokens in the message".
2. **A job retried by BullMQ double-sends or double-hands-off.** The handoff fires only on the final attempt, and enqueueing twice for one action id is a no-op. Pinned by A5 "hands off only on the final attempt" and A6 "enqueueing the same action twice creates one job".
3. **Dates lose their type through Redis.** `Booking.start` is a `Date` and becomes a string in JSON. The processor must revive it before calling `Mailer`. Pinned by A5 "revives booking dates before sending".
4. **The live Calendar run sees events it didn't create** (the user's own demo bookings), and exact-id assertions fail or, worse, cleanup deletes them. Each run tags its events with a unique `frontdesk_run` private property, the adapter filters on it, and cleanup deletes only tracked ids. Pinned by B2 "a tagged adapter never lists untagged events".
5. **Header injection in the confirmation email.** A guest name like `Ana\r\nBcc: x@y.z` would add a header. The MIME builder strips CR/LF from every header value and validates `to`. Pinned by B3 `mime.test.ts` › "strips CR/LF from header values".

---

# Part A — db + audit + worker (`m5-integrations-a`)

### Task A1: Give the confirmation email its audit context

The worker must audit each attempt against an action, but `ConfirmationEmail` carries no ids. A permanently failed email also needs a handoff reason.

**Files:**
- Modify: `packages/core/src/ports/mailer.ts`, `packages/core/src/gate/execute.ts:120-130`, `packages/core/src/agent/types.ts` (`HANDOFF_REASONS`)
- Test: `packages/core/src/gate/execute.test.ts`

**Interfaces:**
- Produces: `ConfirmationEmail { kind; to; booking; businessName; sessionId: string; actionId: string }`; `HandoffReason` gains `"email_failed"` (in `HANDOFF_REASONS`, not in config `HANDOFF_TRIGGERS`).

- [ ] **Step 1:** Extend the existing assertion in `execute.test.ts` (line ~40) to `toMatchObject({ kind: "book", to: "bo@example.com", sessionId: <fixture session id>, actionId: <pending action id> })`. Run `pnpm vitest run --project unit packages/core/src/gate/execute.test.ts` → FAIL.
- [ ] **Step 2:** Add the two fields to the port and pass `action.sessionId` / `action.id` in `execute.ts`. Add `"email_failed"` to `HANDOFF_REASONS`. Run `pnpm verify` → PASS (evals replay unaffected: no scenario expects that reason).
- [ ] **Step 3:** Commit `feat(core): carry session and action ids on confirmation emails`.

### Task A2: `packages/db` schema and migrations for both databases

**Files:**
- Create: `packages/db/src/schema.ts`, `packages/db/drizzle.config.ts`, `packages/db/drizzle/*` (generated), `packages/db/src/migrate.ts`, `packages/db/src/migrate-cli.ts`, `packages/db/src/client.ts`
- Modify: `packages/db/package.json`, `packages/db/src/index.ts`, root `package.json` (`db:migrate`, `db:generate`)
- Test: `packages/db/src/migrate.smoke.test.ts`

**Interfaces:**
- Produces: `createDb(url: string): { db: NodePgDatabase<typeof schema>; close(): Promise<void> }`; `migrate(url: string): Promise<void>` (runs `drizzle-orm/node-postgres/migrator` against `packages/db/drizzle`); tables below.

Tables (snake_case columns; `timestamptz` everywhere; ids are app-made `text`):

| Table | Columns |
|---|---|
| `conversations` | `id` pk, `source` text check in (`live`,`pilot`,`eval`), `started_at`, `ended_at` null, `outcome` text null, `handoff_reason` text null |
| `turns` | `id` pk, `conversation_id` fk, `turn_index` int, `caller_text`, `agent_text`, `stt_ms` int null, `llm_ttft_ms` int null, `llm_total_ms` int null, `tool_ms` int[] not null default `{}`, `tts_start_ms` int null, `total_ms` int null, `tokens_in` int, `tokens_out` int, `cost_usd` numeric(12,6), `flags` jsonb default `[]`, `created_at`; unique (`conversation_id`,`turn_index`) |
| `audit_log` | `seq` bigserial pk, `at`, `session_id`, `turn_id` null, `action_id`, `kind` check in (`book`,`reschedule`,`cancel`), `stage` check in (`proposed`,`confirmed`,`executed`,`failed`,`voided`,`email_sent`,`email_failed`), `args` jsonb null, `result` jsonb null, `reason` text null; index on (`action_id`), (`session_id`) |
| `handoffs` | `id` pk, `session_id`, `reason` text, `summary` text, `transcript` jsonb, `created_at`, `resolved_at` null, `notes` text null |
| `feedback` | `id` pk, `conversation_id` fk null, `rating` int null check 1–5, `comment` text, `created_at` |

`conversations.id` equals the core session id. No `bookings` table (Calendar is the source of truth).

- [ ] **Step 1: Write the failing test** `migrate.smoke.test.ts` (uses `tests/infra/env.ts` URLs):
  - "migrates the live and eval databases, twice without error" — `await migrate(url)` ×2 for each of `databaseUrl`, `evalDatabaseUrl`.
  - "creates every table" — `select table_name from information_schema.tables where table_schema='public'` contains `conversations, turns, audit_log, handoffs, feedback`.
  - "turns has every per-turn metric column" — `information_schema.columns` for `turns` includes the nine §8 columns.
- [ ] **Step 2:** Run `pnpm test:infra -- packages/db` → FAIL (module missing).
- [ ] **Step 3:** Add deps (`drizzle-orm`, `pg`, devDeps `drizzle-kit`, `@types/pg`, `tsx`), write `schema.ts`, run `pnpm db:generate` to emit `drizzle/0000_*.sql`. `migrate-cli.ts` loads `.env` via dotenv and migrates `DATABASE_URL` then `EVAL_DATABASE_URL`, printing only the database name (never the URL — it holds a password).
- [ ] **Step 4:** Run `pnpm test:infra -- packages/db` → PASS; `pnpm verify` → PASS.
- [ ] **Step 5:** Commit `feat(db): schema and migrations for live and eval databases`.

### Task A3: Append-only trigger on `audit_log`

**Files:**
- Create: `packages/db/drizzle/0001_audit_log_append_only.sql` (via `drizzle-kit generate --custom --name audit_log_append_only`)
- Test: `packages/db/src/audit-append-only.smoke.test.ts`

- [ ] **Step 1: Write the failing test** (each runs against both databases via `describe.each`):
  - "rejects UPDATE on audit_log" — insert a row, then `update audit_log set reason='x'` rejects with `/append-only/`.
  - "rejects DELETE on audit_log" — `delete from audit_log` rejects with `/append-only/`.
  - "rejects TRUNCATE on audit_log" — rejects with `/append-only/`.
  - "still accepts INSERT" — row count increases by 1.
- [ ] **Step 2:** Run → FAIL (update succeeds).
- [ ] **Step 3:** Migration body: a plpgsql function `audit_log_reject_change()` that `raise exception 'audit_log is append-only (%)', TG_OP`; a `BEFORE UPDATE OR DELETE ... FOR EACH ROW` trigger and a `BEFORE TRUNCATE ... FOR EACH STATEMENT` trigger calling it.
- [ ] **Step 4:** Run → PASS. Commit `feat(db): audit_log rejects update, delete and truncate`.

### Task A4: Postgres adapters

**Files:**
- Create: `packages/db/src/audit-log.ts`, `packages/db/src/handoff-queue.ts`, `packages/db/src/conversations.ts`
- Test: `packages/db/src/adapters.smoke.test.ts`

**Interfaces:**
- Consumes: core `AuditLog`, `AuditEvent`, `HandoffQueue`, `HandoffTicket`.
- Produces:
  - `class PgAuditLog implements AuditLog` — `append(event)`; `recordEmailAttempt(a: EmailAttempt): Promise<void>`; `forAction(actionId): Promise<AuditRow[]>` (ordered by `seq`).
  - `type EmailAttempt = { at: string; sessionId: string; actionId: string; kind: ActionKind; ok: boolean; attempt: number; error?: string }` → stage `email_sent`/`email_failed`, `result = { attempt }`, `reason = error`.
  - `class PgHandoffQueue implements HandoffQueue` — `enqueue(ticket)`; `open(): Promise<HandoffTicket[]>` (unresolved, oldest first).
  - `class PgConversations` — `start({ id, source, startedAt })`, `recordTurn(t: TurnRecord)`, `end(id, { endedAt, outcome, handoffReason? })`, `addFeedback({ id, conversationId?, rating?, comment, createdAt })`, `turns(conversationId): Promise<TurnRecord[]>`.
  - `type TurnRecord` — camelCase mirror of the `turns` columns.
  - Each constructor takes the `db` from `createDb`.

Tests (infra; each test uses fresh ids from `crypto.randomUUID()` so runs don't collide):
- [ ] **Step 1: Write the failing tests:**
  - "PgAuditLog round-trips an AuditEvent" — append `proposed` then `executed` with a `result` booking; `forAction` returns both in order with `args` deep-equal (dates as ISO strings).
  - "PgAuditLog records email attempts as email_sent / email_failed" — attempt 1 fails with error `"smtp 503"`, attempt 2 ok → stages `["email_failed","email_sent"]`, `result.attempt` `[1,2]`.
  - "PgHandoffQueue enqueues and lists open tickets with transcript" — deep-equals the ticket.
  - "PgConversations stores a turn with every metric and reads it back" — `toolMs: [12, 40]`, `costUsd: 0.000123`.
  - "PgConversations rejects an unknown source" — `start({ source: "test" })` rejects.
  - "rejects a duplicate turn index" — second `recordTurn` with same index rejects.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with Drizzle query builder. **Step 4:** Run → PASS; `pnpm verify` → PASS.
- [ ] **Step 5:** Commit `feat(db): Postgres audit log, handoff queue and conversation store`.

### Task A5: Worker job contract and processor (unit)

**Files:**
- Create: `apps/worker/src/confirmation-job.ts`, `apps/worker/src/process-confirmation.ts`
- Modify: `apps/worker/package.json` (deps `@frontdesk/core`, `@frontdesk/db`, `bullmq`, `ioredis`, `zod`), `apps/worker/tsconfig.json` references
- Test: `apps/worker/src/process-confirmation.test.ts`, `apps/worker/src/confirmation-job.test.ts`

**Interfaces:**
- Produces:
  - `CONFIRMATION_QUEUE = "confirmation-email"`, `EMAIL_ATTEMPTS = 5`, `EMAIL_BACKOFF = { type: "exponential", delay: 2000 }`.
  - `type ConfirmationJob = { email: ConfirmationEmail }` serialized as JSON; `parseConfirmationJob(data: unknown): ConfirmationEmail` (Zod; revives `booking.start/end` to `Date`; throws on bad data).
  - `interface ConfirmationQueue { add(name: string, data: ConfirmationJob, opts: JobsOptions): Promise<unknown> }` (BullMQ `Queue` satisfies it).
  - `enqueueConfirmation(queue: ConfirmationQueue, email: ConfirmationEmail): Promise<void>` — `jobId: \`confirm-${email.actionId}\``, `attempts: EMAIL_ATTEMPTS`, `backoff: EMAIL_BACKOFF`, `removeOnComplete: true`, `removeOnFail: false`.
  - `class QueueMailer implements Mailer` — `sendConfirmation(email)` = `enqueueConfirmation(this.queue, email)`. M6 passes this as the gate's `mailer`.
  - `interface EmailAttemptLog { recordEmailAttempt(a: EmailAttempt): Promise<void> }` (`PgAuditLog` satisfies it).
  - `processConfirmation(data: unknown, attempt: { made: number; max: number }, deps: { mailer: Mailer; attempts: EmailAttemptLog; handoffs: HandoffQueue; clock: Clock; ids: IdGenerator }): Promise<void>` — `made` = attempts already made before this one.

Behavior: parse; send; record `ok:true, attempt: made+1`. On send error: record `ok:false` with the error's `message` only; if `made + 1 >= max`, enqueue a handoff `{ reason: "email_failed", sessionId, summary: "Confirmation email to <to> failed after 5 attempts; the <kind> for <name> at <ISO start> stands.", transcript: [] }`; then rethrow so BullMQ schedules the retry. An attempt-log failure must not hide the send result: log errors propagate only after the send outcome is known.

- [ ] **Step 1: Write the failing tests** with `InMemoryMailer`, `InMemoryHandoffQueue`, a recording `EmailAttemptLog`, and a mailer stub that fails N times:
  - "sends and records attempt 1 as ok"
  - "records a failed attempt and rethrows"
  - "hands off only on the final attempt" — fail at `made: 3, max: 5` → no ticket; at `made: 4` → one ticket with reason `email_failed`
  - "revives booking dates before sending" — `JSON.parse(JSON.stringify(job))` input → `mailer.sent[0].booking.start instanceof Date`
  - "rejects malformed job data without sending"
  - `confirmation-job.test.ts`: "enqueueConfirmation uses the action id as job id with 5 attempts and exponential backoff" (fake queue records `add` args); "QueueMailer enqueues instead of sending"
- [ ] **Step 2:** Run `pnpm vitest run --project unit apps/worker` → FAIL. **Step 3:** Implement. **Step 4:** PASS; `pnpm verify` PASS.
- [ ] **Step 5:** Commit `feat(worker): confirmation job, typed enqueue and processor`.

### Task A6: BullMQ worker runtime on Redis

**Files:**
- Create: `apps/worker/src/worker.ts`, `apps/worker/src/main.ts`
- Modify: `apps/worker/src/index.ts` (export enqueue API, `QueueMailer`, `createConfirmationQueue`), `apps/worker/package.json` (`start: tsx src/main.ts`)
- Test: `apps/worker/src/worker.smoke.test.ts`

**Interfaces:**
- Produces: `createConfirmationQueue(redisUrl: string, prefix?: string): Queue<ConfirmationJob>`; `startConfirmationWorker(opts: { redisUrl: string; prefix?: string; deps: ProcessDeps; backoffMs?: number }): { close(): Promise<void> }` — BullMQ `Worker` calling `processConfirmation(job.data, { made: job.attemptsMade, max: job.opts.attempts ?? EMAIL_ATTEMPTS }, deps)`; ioredis connection with `maxRetriesPerRequest: null` (BullMQ requirement). `backoffMs` overrides the delay only in tests via a custom backoff strategy. `main.ts` wires `PgAuditLog`, `PgHandoffQueue`, a `Mailer` (Part A: refuses to start without a real mailer and says "Gmail adapter arrives in M5 part B"; Part B wires `GmailMailer`), `systemClock`, `randomUUID` ids, and shuts down on SIGINT/SIGTERM.

- [ ] **Step 1: Write the failing smoke tests** (real Redis; unique `prefix` per test; `backoffMs: 5`; in-memory deps):
  - "a queued confirmation is sent once" — enqueue, wait for `completed`, `mailer.sent` length 1.
  - "five failures: five audited attempts, one handoff, no sixth try" — always-failing mailer; wait for `failed` with `attemptsMade === 5`; attempts log has 5 `ok:false`; handoffs has 1.
  - "succeeds on the third attempt with no handoff" — attempts `[false,false,true]`.
  - "enqueueing the same action twice creates one job".
- [ ] **Step 2:** Run `pnpm test:infra -- apps/worker` → FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(worker): BullMQ confirmation worker with retries`.

### Task A7: Part A docs, env and wrap-up

**Files:**
- Create: `docs/learning/m5-integrations.md` (Part A sections; Part B extends it)
- Modify: `.env.example` (comment: worker uses `REDIS_URL`, `DATABASE_URL`), `README` only if it lists scripts

- [ ] **Step 1:** Learning note in the M3/M4 format: reading order (one line per file), key concepts (DB migration, trigger, adapter vs interface, job queue + retries/backoff, idempotent job id), holes table naming the guarding test, 8–12 quiz questions in `<details>`. 1–2 pages.
- [ ] **Step 2:** `pnpm verify` and `pnpm test:infra` → PASS. Commit `docs(learning): M5 part A guide`.
- [ ] **Step 3:** Whole-branch review (fresh reviewer, most capable model; also check secret handling and the append-only guarantee), fix pass, then finishing-a-development-branch → PR against `main`.

---

# Part B — Google adapters (`m5-integrations-b`, from `main` after A merges)

### Task B1: Google env, OAuth client and safe errors

**Files:**
- Create: `packages/integrations/src/google/env.ts`, `packages/integrations/src/google/client.ts`, `packages/integrations/src/google/errors.ts`
- Modify: `packages/integrations/package.json` (deps `@frontdesk/core`, `googleapis`, `google-auth-library`, `dotenv`), tsconfig references, `.env.example` (empty `GOOGLE_CLIENT_ID=`, `GOOGLE_CLIENT_SECRET=`, `GOOGLE_REFRESH_TOKEN=`, `GOOGLE_CALENDAR_ID=`, `GMAIL_TEST_TO=`)
- Test: `env.test.ts`, `errors.test.ts`, `tests/lint/secrets.test.ts`

**Interfaces:**
- Produces: `GOOGLE_SCOPES` (the two scopes above); `readGoogleEnv(env = process.env): GoogleEnv | undefined` (undefined if any of id/secret/refresh/calendar missing; throws if calendar id is `primary`); `createOAuthClient(env: GoogleEnv): OAuth2Client` (`setCredentials({ refresh_token })`); `googleFailure(error: unknown, what: string): Error` — message `"<what> failed: <status> <reason>"`, no `cause`; `isUnavailable(error)` = network error / timeout / status ≥ 500 / 429.

- [ ] **Step 1: Failing tests:** "returns undefined when any credential is missing"; "refuses the primary calendar"; "never includes request headers or tokens in the message" (a fake `GaxiosError`-shaped object with `config.headers.Authorization = "Bearer ya29.SECRET"` and `response.data.error_description` containing the refresh token → message contains neither `SECRET` nor the token, and `cause` is undefined); `secrets.test.ts`: "`.env` is git-ignored" (`git check-ignore .env`) and "`.env.example` leaves every GOOGLE_* secret empty".
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(integrations): Google env, OAuth client and secret-safe errors`.

### Task B2: Google Calendar adapter + shared contract

**Files:**
- Create: `packages/integrations/src/google/calendar.ts`, `packages/integrations/src/google/event-mapping.ts`
- Modify: `packages/core/src/testing/calendar-contract.ts` (options), `package.json` root script `test:google` = `vitest run --project live packages/integrations`
- Test: `event-mapping.test.ts`, `google-calendar.live.test.ts`

**Interfaces:**
- Consumes: core `Calendar`, `Booking`, `NewBooking`, `CalendarUnavailableError`, `normalizeContact`, `runCalendarContract`.
- Produces:
  - `runCalendarContract(name, make, opts?: { afterEach?: () => Promise<void>; skip?: boolean })`.
  - `toEvent(b: NewBooking, tag?: string): calendar_v3.Schema$Event` — `summary: "<name> (party of <n>)"`, `start/end.dateTime` ISO, `extendedProperties.private = { frontdesk: "1", partySize, tableId, name, contact, contactKey: normalizeContact(contact), notes, frontdesk_run?: tag }`. No attendees (Google would email the guest).
  - `fromEvent(e): Booking | undefined` — undefined if `status === "cancelled"` or `frontdesk !== "1"`.
  - `class GoogleCalendar implements Calendar` — `constructor(opts: { auth: OAuth2Client; calendarId: string; tag?: string; api?: calendar_v3.Calendar })`. `list` = `events.list({ timeMin: from, timeMax: to, singleEvents: true, privateExtendedProperty: ["frontdesk=1", tag && "frontdesk_run=<tag>"], maxResults: 2500 })` following `nextPageToken`, sorted by start. `get` 404/410 → undefined. `find` filters by `contactKey=<normalized>` then case-insensitive name (empty contact → `[]`). `move` = `events.patch`. `cancel` = `events.delete`; 404/410 → throw. Unavailable errors → `CalendarUnavailableError`; others → `googleFailure`.
- [ ] **Step 1: Failing unit tests** (`event-mapping.test.ts`): "round-trips a booking through toEvent/fromEvent"; "ignores cancelled and non-frontdesk events"; "a tagged adapter never lists untagged events" (fake `api.events.list` asserts the `frontdesk_run=` filter is sent).
- [ ] **Step 2: Live contract** `google-calendar.live.test.ts`: `const env = readGoogleEnv()`; tag = `test-<randomUUID>`; `make()` wraps a `GoogleCalendar` in a tracker recording created ids; `afterEach` deletes every tracked id (ignoring 404/410) and asserts a tagged `listReservations` over a wide range is empty; `skip: !env`. Plus "maps a network failure to CalendarUnavailableError" (adapter pointed at an `api` whose methods reject `ECONNREFUSED`, unit-level).
- [ ] **Step 3–4:** Implement; `pnpm test` PASS (live suite skipped); with credentials `pnpm test:google` PASS. **Step 5:** Commit `feat(integrations): Google Calendar adapter with shared contract tests`.

### Task B3: Gmail mailer + shared contract

**Files:**
- Create: `packages/integrations/src/google/mime.ts`, `packages/integrations/src/google/gmail.ts`, `packages/core/src/testing/mailer-contract.ts`
- Test: `mime.test.ts`, `packages/core/src/adapters/memory/memory.test.ts` (in-memory run), `gmail.live.test.ts`

**Interfaces:**
- Produces: `renderConfirmation(email: ConfirmationEmail, timeZone: string): { subject: string; text: string }` (subject `"Your reservation at <business> is confirmed" | "…has been moved" | "…has been cancelled"`; body has date/time in the business time zone, party size, name); `buildRawMessage({ to, subject, text }): string` (RFC 2822, UTF-8, RFC 2047 subject, base64url); `class GmailMailer implements Mailer` — `constructor({ auth, timeZone, api? })`, `users.messages.send({ userId: "me", requestBody: { raw } })`, errors via `googleFailure`; `runMailerContract(name, make: () => { mailer: Mailer; to: string }, opts?: { skip?: boolean })` — "sends a booking confirmation", "sends a cancellation".
- [ ] **Step 1: Failing tests:** "strips CR/LF from header values"; "rejects a `to` that is not a single address"; "encodes a non-ASCII subject"; "renders 7:00 PM for a 19:00 America/New_York booking"; in-memory `runMailerContract` run; live run to `GMAIL_TEST_TO` skipped without credentials.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(integrations): Gmail confirmation mailer`. Wire `GmailMailer` into `apps/worker/src/main.ts` in the same commit.

### Task B4: `pnpm google:auth` and the setup guide

**Files:**
- Create: `packages/integrations/src/google/auth-flow.ts`, `packages/integrations/scripts/google-auth.ts`, `docs/google-setup.md`
- Modify: root `package.json` (`google:auth`)
- Test: `auth-flow.test.ts`

**Interfaces:**
- Produces: `upsertEnvLine(contents: string, key: string, value: string): string` (replaces or appends; preserves other lines); `authUrl(client, state)` (`access_type: "offline"`, `prompt: "consent"`, `scope: GOOGLE_SCOPES`); `checkCallback(url: URL, expectedState: string): string` (returns code; throws on state mismatch or `error=`).
- Script: reads id/secret from `.env`, listens on `127.0.0.1` random port, redirect `http://127.0.0.1:<port>/oauth2callback`, opens the consent URL in the browser (prints it as a fallback), exchanges the code, writes `GOOGLE_REFRESH_TOKEN` into `.env` with `upsertEnvLine`, prints only `"Saved a refresh token to .env"`. Exits with a clear message if no refresh token came back ("revoke access at myaccount.google.com/permissions and rerun").
- `docs/google-setup.md`: numbered click-by-click steps — create project; enable Calendar API and Gmail API; OAuth consent screen (External, Testing, own account as test user, the two scopes); OAuth client (type **Desktop app**), copy id/secret into `.env` yourself; create the "Casa Fiorella (demo)" calendar and copy its Calendar ID (Settings → Integrate calendar) into `GOOGLE_CALENDAR_ID`; run `pnpm google:auth`; run `pnpm test:google`. Note: Testing-mode refresh tokens expire after 7 days — rerun `pnpm google:auth`.
- [ ] **Step 1–4:** TDD the three helpers (unit: "replaces an existing key without touching others", "appends a missing key", "rejects a state mismatch", "surfaces access_denied"). **Step 5:** Commit `feat(integrations): local OAuth script and Google setup guide`.

### Task B5: Live verification and docs

- [ ] **Step 1 (user):** follow `docs/google-setup.md` and run `pnpm google:auth`. Never paste secrets into chat.
- [ ] **Step 2:** `pnpm test:google` → all live contract tests PASS; confirm the demo calendar has no leftover test events (the afterEach assertion).
- [ ] **Step 3:** Extend `docs/learning/m5-integrations.md` (OAuth2 + refresh token, contract test, live vs skipped runs; quiz kept to 8–12 total). `pnpm verify` PASS. Commit.
- [ ] **Step 4:** Whole-branch review (most capable model; secret handling focus), fix pass, PR against `main`.
