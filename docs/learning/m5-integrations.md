# M5: Integrations (learning guide)

M5 makes the receptionist's actions real. Up to M4, everything ran on in-memory fakes. M5 adds the real things behind the same interfaces: a Postgres database for history and the audit trail, a background worker that sends confirmation emails, and (in part B) Google Calendar and Gmail. Core's code does not change, because core only talks to interfaces.

This guide covers **part A**: the database and the worker. Part B (Google) extends it.

## 1. Reading order

| #   | File                                                                 | What it's for                                                                                        |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `packages/db/src/schema.ts`                                          | The five tables, as TypeScript. Drizzle turns this into SQL.                                         |
| 2   | `packages/db/drizzle/0000_init.sql`                                  | The SQL that `schema.ts` generated. This is what actually runs against Postgres.                     |
| 3   | `packages/db/drizzle/0001_audit_log_append_only.sql`                 | A hand-written migration: the triggers that make `audit_log` append-only.                            |
| 4   | `packages/db/src/migrate.ts` + `migrate-cli.ts`                      | Applies pending migrations, one process at a time; `pnpm db:migrate` runs it on both databases.      |
| 5   | `packages/db/src/audit-log.ts`                                       | `PgAuditLog`: core's `AuditLog` in Postgres, plus `recordEmailAttempt` for the worker.               |
| 6   | `packages/db/src/handoff-queue.ts`, `conversations.ts`               | The review queue, and conversations/turns/feedback with the per-turn latency and cost record.        |
| 7   | `apps/worker/src/confirmation-job.ts`                                | The job's shape, its retry settings, `enqueueConfirmation`, and `QueueMailer` for the api (M6).      |
| 8   | `apps/worker/src/process-confirmation.ts`                            | One attempt of one job: send, audit, and on the last failure open a handoff.                         |
| 9   | `apps/worker/src/worker.ts` + `main.ts`                              | The BullMQ worker on Redis, and the process that wires it to Postgres.                               |
| 10  | `packages/db/src/*.smoke.test.ts`, `apps/worker/src/*.smoke.test.ts` | Tests against the real Docker Postgres and Redis (`pnpm test:infra`). Read these to see it all work. |

## 2. Key concepts

- **Interface vs adapter.** Core defines `AuditLog`, `HandoffQueue` and `Mailer` as interfaces (what must be possible). An adapter is one concrete way to do it: `InMemoryAuditLog` for tests, `PgAuditLog` for real. The gate calls `audit.append(...)` and never knows which one it got.
- **DB migration.** A numbered SQL file that moves the database schema forward one step. Drizzle records which ones have run in a `drizzle.__drizzle_migrations` table, so running `migrate` again does nothing. We edit `schema.ts`, run `pnpm --filter @frontdesk/db db:generate`, and commit the new SQL file. Never edit a migration that has already run somewhere; add a new one.
- **Two databases.** `frontdesk` holds live and pilot data; `frontdesk_eval` holds eval runs. Both get the same migrations, so real and simulated numbers never mix (spec §10).
- **Advisory lock.** `migrate` first takes a Postgres "advisory lock", a named lock only our code checks. If two processes migrate at once (two test files, or the api and worker starting together), the second waits instead of applying the same file twice.
- **Trigger.** A function Postgres runs automatically on some event. Ours runs _before_ any UPDATE, DELETE or TRUNCATE on `audit_log` and raises an error, so the change never happens. That makes "append-only" true even for someone with a SQL prompt, not just for our TypeScript. One limit: the app connects as the table's owner (a superuser in Docker), and an owner can drop the trigger. A stricter setup gives the app a separate role with only `SELECT, INSERT` on `audit_log`.
- **Job queue.** Sending an email is slow and can fail, so the api doesn't do it during the conversation. It puts a _job_ (a small JSON message) on a queue in Redis, and a separate worker process takes jobs off and does them. BullMQ is the library that manages this.
- **Retries with backoff.** A failed job is tried again, up to 5 attempts in total, waiting 2 s, 4 s, 8 s, then 16 s between tries (exponential backoff). Waiting longer each time gives a flaky service a chance to recover. Every attempt is written to `audit_log` as `email_sent` or `email_failed`. After the 5th failure, a ticket goes to the handoff queue so a human can contact the guest. Its id is fixed per action (`handoff_email_<actionId>`), so a re-run can't create a second ticket, and saving it is retried if the database blips. The booking still stands.
- **Idempotent job id.** The job id is `confirm-<actionId>`. BullMQ ignores a second job with the same id, and completed ids are kept for 24 hours, so a duplicate enqueue can't send a second email.
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

## 4. Quiz

1. Why does `audit_log` need a trigger when `AuditLog` already has no update method?
2. What does a migration file do, and why should you never edit one that has already run?
3. Why do `frontdesk` and `frontdesk_eval` both get every migration?
4. What would happen without the advisory lock in `migrate`?
5. Why does the api queue the confirmation email instead of sending it during the conversation?
6. A send fails 5 times. What ends up in `audit_log`, in the handoff queue, and in Google Calendar?
7. Why does the handoff only happen when `made + 1 >= max`?
8. Why is the job id built from the action id, and why keep completed jobs for 24 hours?
9. Recording an attempt in Postgres fails right after the email was sent. Why must the job still succeed?
10. Why does `parseConfirmationJob` exist when the api already sent a correctly typed email?

<details>
<summary>Answers</summary>

1. The interface only limits our TypeScript. The trigger limits everyone, including a bug in a future adapter or a person at a SQL prompt. The database itself refuses the change.
2. It moves the schema forward one step, and Drizzle remembers it ran. A database that already ran the old version would never see your edit, so two databases would silently differ. Add a new migration instead.
3. Eval runs write to `frontdesk_eval` so simulated conversations never mix with real ones (spec §10). The code is the same, so the schema must be too.
4. Two processes could both see a migration as pending and both apply it. The second one fails ("function already exists") or, worse, half-applies. The tests hit exactly this before the lock was added.
5. Sending is slow and can fail. The caller shouldn't wait for Gmail, and a Gmail outage shouldn't break the booking. The queue lets the worker retry later on its own.
6. `audit_log`: five `email_failed` rows with attempts 1 to 5. Handoff queue: one `email_failed` ticket. Calendar: the reservation, unchanged. The booking stands.
7. `made` counts the attempts before this one, so `made + 1` is this attempt's number. Only the 5th failure is final; earlier ones will be retried and may still succeed.
8. BullMQ ignores a job whose id already exists, so the same action can't be emailed twice. If completed jobs were deleted straight away, their id would be free again, and a late duplicate would send a second email.
9. If the job failed, BullMQ would retry it and the guest would get the email again. The worker logs the audit failure to stderr instead.
10. Jobs come out of Redis as untyped JSON: dates are strings, and the data could be from an older version or corrupted. Validating at the boundary turns "trust me" into a checked type.

</details>
