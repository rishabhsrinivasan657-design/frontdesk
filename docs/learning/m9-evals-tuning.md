# M9: Evals tuning (learning guide)

M9 turns M4's 15-scenario harness into evidence: **100 scenarios**, a tuning loop that fixed what they found, and a baseline with **0 unsafe actions**. It shipped in two PRs. **Part A** added the scenarios, three harness features, the agent fixes and the frozen-prompt recordings. **Part B** folded in PR #22 (a party-size change is one confirmed reschedule, prompt `agent-turn-v5`), re-recorded all 100 on v5, and added the 30-scenario CI subset, the targets check and the final baseline.

## 1. Reading order

| #   | File                                                                                        | What it's for                                                                                                    |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | `docs/superpowers/plans/2026-10-25-m9-evals-tuning.md`                                      | The plan: the scenario list by category, the quota budget, the two PRs.                                          |
| 2   | `packages/evals/scenarios/*.yaml`                                                           | 100 scenarios. Read `policy-pending-expires`, `vague-party-grows-after-booking` and one `injection-*` first.     |
| 3   | `packages/evals/src/scenarios.test.ts`                                                      | Suite-level checks: ~100, ≥5 per category, and that "full slot" seeds really are full.                           |
| 4   | `packages/evals/src/run.ts`                                                                 | New: `readbackPauseMinutes` (lets a pending action expire), and the caller answers a question before hanging up. |
| 5   | `packages/evals/src/wrappers.ts` › `withMetaTap`, `report.ts` › `confidenceSweep`           | Records the agent's `@meta` confidence and shows what a higher threshold would do.                               |
| 6   | `packages/evals/src/score.ts`                                                               | `extra_event` now counts bookings still in the calendar (a confirmed cancel + rebook isn't an extra table).      |
| 7   | `packages/core/src/availability/tables.ts` › `agentPartyLimit`                              | Parties of 7–8 could never be seated (largest table 6, never combined): now they hand off.                       |
| 8   | `packages/core/src/gate/propose.ts` › `sameCallerOverlapping`                               | Code guard: no second overlapping table for the same name and contact.                                           |
| 9   | `packages/core/src/guardrails/grounding.ts` › `buildFacts`                                  | Any date in the booking window is grounded (suggesting "Tuesday instead" no longer hands off).                   |
| 10  | `packages/core/src/agent/prompt.ts` (`agent-turn-v5`)                                       | The tuned rules. Each one is general; none names a scenario's person, dish or date.                              |
| 10b | `packages/core/src/gate/propose.ts` › `reschedule`, `ports/calendar.ts` › `moveReservation` | PR #22: "3 of us now" is one reschedule with a new party size, not cancel + book.                                |
| 11  | `packages/evals/ci-subset.json`, `baseline.json`                                            | The 30 scenarios CI replays (every category, ≥3 of each risky one) and the scores they must hold.                |
| 12  | `packages/evals/targets.json`, `gate.ts` › `checkTargets`, `RESULTS.md`                     | `pnpm eval:targets`: all 100, offline, must clear the targets; and the full-suite scoreboard.                    |

## 2. Key concepts

- **Eval coverage.** One scenario per category proves little. M9 weights the risky categories (injection 13, policy_edge 13, double_booking 12, handoff 12, vague 10) and adds multi-step calls: a reschedule after a full slot, changing your mind at the read-back, a read-back that expires, party size 8, a booking inside the 4-hour window.
- **Overfitting to evals.** Making the score go up without making the agent better. The two easy ways are editing `expect` to match what the agent did, and writing prompt rules that name one scenario's details. M9 forbids both. An `expect` changes only when the scenario was wrong, with a ruling; prompt rules must read as general policy.
- **Prompt tuning vs code fixes.** If the agent _can't_ do the right thing, fix the code (no known booking to change, a grounding false alarm, no menu lookup by diet). If it _can_ but chooses badly, tune the prompt (handing off pranks, assuming a party size). Safety lives in code: the duplicate-table guard is code, not a prompt sentence.
- **Caller drift.** The simulator (`gemma3:4b`) sometimes ignores its goal: it books when told to only ask, or hangs up mid-question. Most pass-1 failures were this. The fix belongs in the scenario's wording ("only after the read-back…", "you are not done until…") or the harness, never in the agent.
- **Promise checks.** Gemini sometimes said "let me transfer you" without calling `request_handoff`, so no ticket reached the team. A reply that _states_ a transfer now gets one nudge to call the tool (`promisesHandoff` in `loop.ts`). A question ("Would you like me to connect you?") is an offer and is left alone.
- **Thresholds.** The confidence threshold (0.5) hands off when the model says it's unsure. The sweep showed the model never reported below 0.8 in 100 calls, so raising it would change nothing. It stays at 0.5, and that's a decision backed by data, not a default.
- **Stale recordings.** Every prompt change (v1 → v4) made every recording stale. So: diagnose with a pass, batch all fixes, and re-record once. The daily 500-request free quota is roughly one full pass.
- **A subset for CI, the whole suite for targets.** The 30-scenario subset is the fast regression gate; `pnpm eval:targets` replays all 100 (still keyless) against the targets. Both run in CI.
- **Baselines and targets.** The baseline is "don't get worse": CI fails on a drop of more than 2 points. Targets are "good enough to ship", set from the data and confirmed by a human. Unsafe = 0 is both.

## 3. Potential holes and the tests that guard them

| What could go wrong                                                        | Guarded by                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| An "expiry" scenario never actually lets the read-back expire              | `run.test.ts` › "advances the clock once after the first read-back"                                           |
| A "full slot" scenario isn't full, so it passes for the wrong reason       | `scenarios.test.ts` › "… really has no table for 6 at 8pm Saturday" and the other seed checks                 |
| A caller saying "3 of us" gets a second table                              | `propose.test.ts` › "refuses a second booking for the same caller at an overlapping time"                     |
| The guard blocks a friend's table or a different person with the same name | `propose.test.ts` › "allows a booking at an overlapping time for …"                                           |
| The agent can't change a booking it made earlier in the call               | `conversations.test.ts` › "cancels a booking made earlier in the same call"                                   |
| A party of 7 is offered a table that can't exist                           | `read-tools.test.ts` › "hands off a party larger than every table…", `tables.test.ts`                         |
| Suggesting another day fails grounding and hands off                       | `grounding.test.ts` › "accepts any date inside the booking window…"                                           |
| A confirmed cancel + rebook is scored unsafe                               | `score.test.ts` › "does not count a booking cancelled with a confirmed yes as an extra event"                 |
| A small caller hangs up on "Shall I book it?"                              | `run.test.ts` › "keeps the call going when the agent answers a goodbye with a question"                       |
| A tuned prompt rule silently disappears                                    | `prompt.test.ts` › "tells the agent when not to hand off…", "…not to assume details…"                         |
| "Let me transfer you" but no handoff ticket is filed                       | `conversations.test.ts` › "hands off when the reply promises a transfer…", `loop.test.ts` › `promisesHandoff` |
| A party of 9 asks for "a person" and is filed under the wrong reason       | `conversations.test.ts` › "files a handoff for a party the agent can't seat as party_too_large"               |
| The CI subset quietly loses a category                                     | `scenarios.test.ts` › "the CI subset covers every category with about 30 scenarios…"                          |
| The whole suite drops below its targets while the subset holds             | `gate.test.ts` › `checkTargets`, `main.test.ts` › "--targets fails below a target", CI `pnpm eval:targets`    |
| CI stops checking the targets                                              | `tests/lint/ci-evals.test.ts` › "the evals job also checks the whole suite against its targets"               |

## 4. Quiz

1. Why does M9 put 13 scenarios in `injection` but only 6 in `angry`?
2. Name the two ways to overfit an eval suite that M9 forbids.
3. Pass 1 had 6 failures where the transcript ended on "Shall I book it?". Was that an agent bug? What was fixed?
4. The agent booked a second table when the caller said "3 of us". Why fix it in code and not only in the prompt?
5. Why do Raj (same name and email, overlapping time) and Mia (same email, different name) get different answers from the duplicate guard?
6. What does `readbackPauseMinutes: 6` do, and why must it be more than 5?
7. The confidence sweep showed 0 runs under 0.8. What did we decide about the threshold, and why?
8. Why does one prompt edit cost a whole day of free quota?
9. Why did grounding hand off "We're closed Monday. How about Tuesday, November 10?" before M9?
10. A confirmed cancel then a confirmed rebook used to score `extra_event`. Why was the scorer wrong, and what still catches a real problem?
11. What's the difference between the baseline and the targets?
12. Why does `--targets` refuse `--subset ci`?

<details>
<summary>Answers</summary>

1. Coverage is weighted by risk. An injection that works can change other people's bookings; an angry caller mostly needs a correct handoff.
2. Editing `expect` to match what the agent did, and writing prompt rules that name a scenario's details.
3. No. The simulated caller gave its email with `done: true`, so the run ended before it could answer. The harness now keeps the call going when the agent's reply ends with a question.
4. Safety must hold no matter what the model decides. The prompt rule makes it likelier the agent does the right thing; the code guard in `propose` makes the wrong thing impossible.
5. The guard matches the same name **and** the same contact. Raj matches both, so it's a duplicate. Mia's name differs, so it's a legitimate second table.
6. It jumps the clock 6 minutes right after the first read-back. The pending action expires after 5 minutes, so the caller's "yes" arrives too late and must be re-proposed.
7. It stays at 0.5. Raising it to anything up to 0.8 would change no run, so there's no evidence for a different number.
8. The recordings store a hash of the prompt template. A new template stales every agent recording, and re-recording 100 scenarios takes about 500 calls, the whole free daily quota.
9. "November 10" didn't come from any tool result, so the check called it ungrounded, regenerated, failed again and handed off. Now any date inside the booking window counts as a fact.
10. The final calendar had one table, the one the caller wanted. Spec §9's "extra events" is about what's left behind. A create or cancel without a confirmed action is still flagged as `unconfirmed_write`.
11. The baseline guards against getting worse (more than a 2-point drop fails CI). Targets are the bar the suite must clear at all, set once from M9's data.
12. Targets were set from the whole 100-scenario suite. The subset's score is a different number, so checking it against those targets would mean nothing.

</details>
