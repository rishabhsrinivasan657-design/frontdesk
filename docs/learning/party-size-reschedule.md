# Party-size change as one reschedule (learning guide)

M9's final review found a gap. When a caller said "we're 3 now, not 2", the only way to change the booking was to cancel it and then book again. Each step had its own read-back. If the new size didn't fit after the cancel, the caller had no table at all. In the eval `vague-party-grows-after-booking`, the agent also kept reading back "cancel" while the caller kept saying "change it to 3". This note covers the fix: `reschedule` can now change the party size in one Calendar write, with one read-back.

## 1. Reading order

| #   | File                                                    | What it does                                                                                                                       |
| --- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/core/src/ports/calendar.ts`                   | `MoveTo`: `moveReservation` now takes an optional `partySize`. Leave it out to keep the party.                                     |
| 2   | `packages/core/src/testing/calendar-contract.ts`        | Two new contract cases that every adapter must pass: with a `partySize`, and without one.                                          |
| 3   | `packages/core/src/adapters/memory/calendar.ts`         | In-memory adapter: `partySize = existing.partySize` as a default.                                                                  |
| 4   | `packages/integrations/src/google/calendar.ts`          | Google adapter: the same default, then `toEvent` writes it to `extendedProperties.private.partySize`.                              |
| 5   | `packages/core/src/gate/propose.ts`                     | `reschedule` no longer returns `party_mismatch`. A slot above `agentPartyLimit` hands off as `party_too_large`.                    |
| 6   | `packages/core/src/gate/summary.ts`                     | The read-back states the old and new party size (and both times when the time changes too).                                        |
| 7   | `packages/core/src/gate/execute.ts`                     | The one write passes `partySize: slot.partySize` to `moveReservation`.                                                             |
| 8   | `packages/core/src/agent/prompt.ts`, `tools/schemas.ts` | `agent-turn-v5`: "check_availability for the new size, then reschedule". The `reschedule` description says it can change the size. |
| 9   | `packages/core/src/agent/conversations.test.ts`         | "changes a party of 2 to 3 with one read-back and no cancel": the whole call, scripted.                                            |

## 2. What changed

**Before.** A slot's id ends in `#<partySize>` (`2026-11-06T19:00@t4-1#3`). `check_availability` picks a table that fits that party, so a slot is always "this table, this time, this many people". `reschedule` refused any slot whose party size differed from the reservation's, because `moveReservation` could only change `start`, `end` and `tableId`. A bigger party might need a bigger table, and the booking's stored size would have been wrong.

**After.** The agent checks availability for the new size, usually at the same time, and calls `reschedule` with that slot. The gate:

1. still requires a `reservationId` from `find_reservation` and a `slotId` from `check_availability` (provenance),
2. still hands off inside the free-change window (`late_change`),
3. hands off a slot bigger than `agentPartyLimit` (`party_too_large`). `check_availability` already refuses those, but the gate doesn't trust anything that came before it,
4. re-checks the slot while ignoring the booking's own hold (`excludeId`). That's why moving from a 2-top to a 4-top at the same 7:00 PM works.

The caller hears one read-back:

> To confirm: change your reservation on Friday, November 6 at 7:00 PM from a party of 2 to a party of 3. Shall I make the change?

On "yes", `confirmAndExecute` makes one `moveReservation` call with the new table and size. There is never a moment when the caller has no booking.

## 3. Key concepts

- **Ports and contract tests.** `Calendar` is a port (an interface). The in-memory adapter and the Google adapter both implement it. `runCalendarContract` is one test suite that runs against both, so a port change is proven the same way for each. The Google contract runs live (`pnpm test:google`, skipped without credentials). A unit test with a fake `events` API covers the patch body in `pnpm test`.
- **`undefined` versus "not there".** `{ ...existing, ...to }` with `to.partySize === undefined` overwrites the stored size with `undefined`, and Google would then store the string `"undefined"`. The adapters destructure with a default (`const { partySize = existing.partySize, ...placement } = to`), so a missing or `undefined` size keeps the old one. The Google unit test "without a party size keeps the stored one" fails without this.
- **Read-backs come from data.** `readBack` builds the text from the reservation and the slot, never from the LLM. The new size is in the read-back because the slot carries it.
- **A prompt change stales every recording.** Recordings are keyed by a hash of the prompt and tool specs. Bumping to `agent-turn-v5` and changing the `reschedule` description means `pnpm eval:ci` reports every scenario as `stale` until a full re-record (about 500 Gemini calls, a full free-tier day). This PR doesn't re-record. That is the M9 part B session's job.

## 4. Potential holes and the tests that guard them

| What could go wrong                                                      | Guarded by                                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| An adapter ignores `partySize`, or drops it when it isn't passed         | `calendar-contract.ts` › "moveReservation with a partySize…" / "…without a partySize keeps the party"                     |
| Google stores `"undefined"` as the party size                            | `calendar.test.ts` › "moveReservation without a party size keeps the stored one"                                          |
| A tampered or bad slot sneaks a party the agent can't seat past the gate | `propose.test.ts` › "hands off a reschedule to a party larger than every table"                                           |
| A size change slips through inside the change window                     | `propose.test.ts` › "hands off a party-size change inside the free-change window"                                         |
| The caller confirms without hearing the new size                         | `propose.test.ts` › "reschedules to a slot for a new party size…" / "reads back a new party size and a new time together" |
| Execution cancels and rebooks, or forgets the size                       | `execute.test.ts` › "changes the party size with one move, never a cancel"                                                |
| The agent is still told to cancel first                                  | `prompt.test.ts` › "changes a party size with one reschedule…"; `propose.test.ts` duplicate-booking message               |

Known gap (from M9, still open): the duplicate-table guard only runs for `book`, so a `reschedule` into a slot that overlaps another booking under the same caller isn't refused.

## 5. Quiz

1. Why couldn't the old `reschedule` just accept a slot for a different party size?
2. The caller has a 2-top at 7:00 PM and wants 3 people at 7:00 PM. Why doesn't their own 2-top block the 4-top slot?
3. What would happen in Google Calendar if the adapter used `{ ...existing, ...to }` and `to.partySize` was `undefined`?
4. `check_availability` already refuses parties above the limit. Why does `propose` check again?
5. Why did this change make every eval recording stale, even scenarios with no party-size change?

### Answers

1. `moveReservation` couldn't store a new size, so the booking would have kept the old party size on a table picked for a different one.
2. `recheckSlot` is passed the reservation's own id (`excludeId`), so the booking being moved is left out of the conflict check.
3. The stored party size would become `undefined`, `toEvent` would write the string `"undefined"`, and `fromEvent` would then refuse the event as "not a booking".
4. The gate is the last line of defence. It doesn't trust earlier steps, and session state such as `offeredSlots` is just data.
5. Recordings are matched by the exact request, which includes the system prompt and the tool descriptions. Both changed, so no old request matches.
