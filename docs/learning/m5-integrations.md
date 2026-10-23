# M5: Integrations (learning guide)

M5 makes the receptionist's actions real. Up to M4, everything ran on in-memory fakes. M5 adds the real things behind the same interfaces: a Postgres database for history and the audit trail, a background worker that sends confirmation emails, Google Calendar for bookings and Gmail for the emails. Core's code barely changes, because core only talks to interfaces. Part A (PR #10) built the database and worker; part B built the Google adapters. To connect your own Google account, follow `docs/google-setup.md`.

## 1. Reading order

| #   | File                                                                   | What it's for                                                                                        |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `packages/db/src/schema.ts`                                            | The five tables, as TypeScript. Drizzle turns this into SQL.                                         |
| 2   | `packages/db/drizzle/0000_init.sql`                                    | The SQL that `schema.ts` generated. This is what actually runs against Postgres.                     |
| 3   | `packages/db/drizzle/0001_audit_log_append_only.sql`                   | A hand-written migration: the triggers that make `audit_log` append-only.                            |
| 4   | `packages/db/src/migrate.ts` + `migrate-cli.ts`                        | Applies pending migrations, one process at a time; `pnpm db:migrate` runs it on both databases.      |
| 5   | `packages/db/src/audit-log.ts`                                         | `PgAuditLog`: core's `AuditLog` in Postgres, plus `recordEmailAttempt` for the worker.               |
| 6   | `packages/db/src/handoff-queue.ts`, `conversations.ts`                 | The review queue, and conversations/turns/feedback with the per-turn latency and cost record.        |
| 7   | `apps/worker/src/confirmation-job.ts`                                  | The job's shape, its retry settings, `enqueueConfirmation`, and `QueueMailer` for the api (M6).      |
| 8   | `apps/worker/src/process-confirmation.ts`                              | One attempt of one job: send, audit, and on the last failure open a handoff.                         |
| 9   | `apps/worker/src/worker.ts` + `main.ts`                                | The BullMQ worker on Redis, and the process that wires it to Postgres.                               |
| 10  | `packages/db/src/*.smoke.test.ts`, `apps/worker/src/*.smoke.test.ts`   | Tests against the real Docker Postgres and Redis (`pnpm test:infra`). Read these to see it all work. |
| 11  | `packages/integrations/src/google/env.ts` + `client.ts`                | Reads the Google credentials from `.env`, refuses `primary`, builds the OAuth2 client.               |
| 12  | `packages/integrations/src/google/errors.ts`                           | Turns a googleapis error into a fresh one with only status + reason, so no token can leak.           |
| 13  | `packages/integrations/src/google/event-mapping.ts`                    | A booking ⇄ a Calendar event, with the details in `extendedProperties.private` (spec §5).            |
| 14  | `packages/integrations/src/google/calendar.ts`                         | `GoogleCalendar`: core's `Calendar` on the demo calendar; outages become `CalendarUnavailableError`. |
| 15  | `packages/integrations/src/google/mime.ts` + `gmail.ts`                | Builds the email (safe headers, UTF-8) and sends it with Gmail as core's `Mailer`.                   |
| 16  | `packages/core/src/testing/calendar-contract.ts`, `mailer-contract.ts` | The shared contract suites; `*.live.test.ts` run them against Google (`pnpm test:google`).           |
| 17  | `packages/integrations/src/google/auth-flow.ts` + `auth-cli.ts`        | `pnpm google:auth`: signs you in on localhost and saves the refresh token to `.env`.                 |

## 2. Key concepts

- **Interface vs adapter.** Core defines `AuditLog`, `HandoffQueue` and `Mailer` as interfaces (what must be possible). An adapter is one concrete way to do it: `InMemoryAuditLog` for tests, `PgAuditLog` for real. The gate calls `audit.append(...)` and never knows which one it got.
- **DB migration.** A numbered SQL file that moves the database schema forward one step. Drizzle records which ones have run in a `drizzle.__drizzle_migrations` table, so running `migrate` again does nothing. We edit `schema.ts`, run `pnpm --filter @frontdesk/db db:generate`, and commit the new SQL file. Never edit a migration that has already run somewhere; add a new one.
- **Two databases.** `frontdesk` holds live and pilot data; `frontdesk_eval` holds eval runs. Both get the same migrations, so real and simulated numbers never mix (spec §10).
- **Advisory lock.** `migrate` first takes a Postgres "advisory lock", a named lock only our code checks. If two processes migrate at once (two test files, or the api and worker starting together), the second waits instead of applying the same file twice.
- **Trigger.** A function Postgres runs automatically on some event. Ours runs _before_ any UPDATE, DELETE or TRUNCATE on `audit_log` and raises an error, so the change never happens. That makes "append-only" true even for someone with a SQL prompt, not just for our TypeScript. One limit: the app connects as the table's owner (a superuser in Docker), and an owner can drop the trigger. A stricter setup gives the app a separate role with only `SELECT, INSERT` on `audit_log`.
- **Job queue.** Sending an email is slow and can fail, so the api doesn't do it during the conversation. It puts a _job_ (a small JSON message) on a queue in Redis, and a separate worker process takes jobs off and does them. BullMQ is the library that manages this.
- **Retries with backoff.** A failed job is tried again, up to 5 attempts in total, waiting 2 s, 4 s, 8 s, then 16 s between tries (exponential backoff). Waiting longer each time gives a flaky service a chance to recover. Every attempt is written to `audit_log` as `email_sent` or `email_failed`. After the 5th failure, a ticket goes to the handoff queue so a human can contact the guest. Its id is fixed per action (`handoff_email_<actionId>`), so a re-run can't create a second ticket, and saving it is retried if the database blips. The booking still stands.
- **Idempotent job id.** The job id is `confirm-<actionId>`. BullMQ ignores a second job with the same id, and completed ids are kept for 24 hours, so a duplicate enqueue can't send a second email.
- **OAuth2 and the refresh token.** Front Desk never sees your Google password. You sign in once in your browser and approve two permissions (_scopes_). Google then gives the app a long-lived **refresh token**, which it trades for a short-lived **access token** (about an hour) on each call. The refresh token is as powerful as those scopes, so it lives only in the git-ignored `.env`. In Testing mode it expires after 7 days; rerun `pnpm google:auth`.
- **Minimal scopes.** We ask for `calendar.events` and `gmail.send` and nothing else: no reading your mail, no deleting calendars. Google can't narrow `calendar.events` to one calendar, so the adapter only ever uses `GOOGLE_CALENDAR_ID` and refuses `primary`.
- **Contract test.** One suite of tests describes what _any_ `Calendar` must do. It runs against `InMemoryCalendar` in every `pnpm test`, and against Google only when credentials exist, otherwise it's skipped, so CI needs no secrets. If both pass the same suite, the fake used by tests and evals behaves like the real thing.
- **Cleaning up live tests.** Every event a live run creates carries a random `frontdesk_run` tag. The adapter lists only tagged events, and after each test the run deletes everything it created and checks nothing is left. Your own demo bookings are never touched.
- **Serialization.** A job travels through Redis as JSON, and JSON has no dates: `booking.start` arrives as a string. `parseConfirmationJob` validates the data with Zod and turns those strings back into `Date`s.

## 3. Potential holes and the tests that guard them

| What could go wrong                                                      | Guarded by                                                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Someone edits or deletes an audit row                                    | `audit-append-only.smoke.test.ts` › "rejects UPDATE", "rejects DELETE", "rejects TRUNCATE" (both databases)     |
| The eval database is missing a table the live one has                    | `migrate.smoke.test.ts` › "creates every table" (runs for live and eval)                                        |
| Two processes migrate at once and one crashes                            | `migrate.smoke.test.ts` and `audit-append-only.smoke.test.ts` migrate in parallel; the advisory lock serializes |
| A turn is saved without its latency or cost fields                       | `adapters.smoke.test.ts` › "stores a turn with every metric and reads it back"                                  |
| An email is never retried, or retried forever                            | `worker.smoke.test.ts` › "five failures: five audited attempts, one handoff, no sixth try"                      |
| The handoff fires on every failed attempt instead of the last            | `process-confirmation.test.ts` › "hands off only on the final attempt"                                          |
| A duplicate enqueue sends a second email                                 | `worker.smoke.test.ts` › "enqueueing the same action again after it was sent sends nothing"                     |
| The mailer gets string dates from Redis                                  | `process-confirmation.test.ts` › "revives booking dates before sending"                                         |
| An audit write fails after a successful send, so BullMQ sends again      | `process-confirmation.test.ts` › "does not fail (and so never re-sends) when auditing a successful send fails"  |
| Garbage job data reaches the mailer                                      | `process-confirmation.test.ts` › "rejects malformed job data without sending"                                   |
| The database is down on the last attempt and the handoff is lost         | `process-confirmation.test.ts` › "retries a failed handoff enqueue so the final failure still reaches a human"  |
| A token in an adapter's error message lands in the undeletable audit log | `process-confirmation.test.ts` › "redacts tokens and caps the error before it is audited"                       |
| A Google error carries the Authorization header or refresh token         | `errors.test.ts` › "never includes request headers or tokens in the message"                                    |
| The in-memory Calendar drifts from real Google behavior                  | the same `runCalendarContract` suite in `memory.test.ts` and `google-calendar.live.test.ts`                     |
| A live test deletes or lists your own demo bookings                      | `calendar.test.ts` › "a tagged adapter never lists untagged events"; the live afterEach checks nothing is left  |
| A guest name like `Ana\r\nBcc: x@y.z` adds an email header               | `mime.test.ts` › "strips CR/LF from header values", "rejects a to that is not a single bare address"            |
| Google is down and the caller hears "booked"                             | `calendar.test.ts` › "maps a network failure to CalendarUnavailableError" (the gate then hands off)             |
| The secrets end up in git                                                | `tests/lint/secrets.test.ts` › ".env is git-ignored", ".env.example leaves every secret empty"                  |
| A forged browser callback injects someone else's sign-in                 | `auth-flow.test.ts` › "rejects a state mismatch"                                                                |

## 4. Quiz

1. Why does `audit_log` need a trigger when `AuditLog` already has no update method?
2. What does a migration file do, and why should you never edit one that has already run?
3. Why does the api queue the confirmation email instead of sending it during the conversation?
4. A send fails 5 times. What ends up in `audit_log`, in the handoff queue, and in Google Calendar?
5. Why does the handoff only happen when `made + 1 >= max`?
6. Why is the job id built from the action id, and why keep completed jobs for 24 hours?
7. Recording an attempt in Postgres fails right after the email was sent. Why must the job still succeed?
8. What is a refresh token, and why is it kept only in `.env`?
9. Why does Front Desk ask for `calendar.events` and `gmail.send` only, and what stops it writing to your primary calendar?
10. What does a contract test prove that two separate test files would not, and why does CI pass without any Google credentials?
11. Why does `googleFailure` build a brand-new error instead of rethrowing Google's?
12. Why are bookings created without attendees?

<details>
<summary>Answers</summary>

1. The interface only limits our TypeScript. The trigger limits everyone, including a bug in a future adapter or a person at a SQL prompt. The database itself refuses the change.
2. It moves the schema forward one step, and Drizzle remembers it ran. A database that already ran the old version would never see your edit, so two databases would silently differ. Add a new migration instead.
3. Sending is slow and can fail. The caller shouldn't wait for Gmail, and a Gmail outage shouldn't break the booking. The queue lets the worker retry later on its own.
4. `audit_log`: five `email_failed` rows with attempts 1 to 5. Handoff queue: one `email_failed` ticket. Calendar: the reservation, unchanged. The booking stands.
5. `made` counts the attempts before this one, so `made + 1` is this attempt's number. Only the 5th failure is final; earlier ones will be retried and may still succeed.
6. BullMQ ignores a job whose id already exists, so the same action can't be emailed twice. If completed jobs were deleted straight away, their id would be free again, and a late duplicate would send a second email.
7. If the job failed, BullMQ would retry it and the guest would get the email again. The worker logs the audit failure to stderr instead.
8. A long-lived credential Google issues after you consent; the app trades it for short-lived access tokens. Anyone holding it can act with those scopes on your account, so it must never be printed, pasted or committed.
9. Least privilege: no reading mail, no deleting calendars. Google can't limit the scope to one calendar, so `readGoogleEnv` refuses `primary` and the adapter only uses `GOOGLE_CALENDAR_ID`.
10. The same assertions run against the fake and the real adapter, so they can't quietly behave differently. The live run is `describe.skipIf(no credentials)`, so CI skips it.
11. googleapis errors carry the request config (the `Authorization: Bearer` header, refresh token, client secret) and free-text messages. Copying only the status and Google's reason code means nothing secret can reach logs or the audit log.
12. Google would email the guest its own calendar invitation. Front Desk sends one confirmation itself, through the worker, with retries and auditing.

</details>
