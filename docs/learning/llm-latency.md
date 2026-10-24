# LLM latency: why chat turns took 10–27 s, and the hedge (learning guide)

M6's live check found that a `/talk` turn waited 11–27 s for Gemini's first token. Spec §8 budgets 1.5 s at p95. This note covers what was measured, why no prompt or setting fixes it on the free tier, and the change we shipped: **hedged requests**. Two free models race on every call, and the first answer wins.

## 1. Reading order

| #   | File                                      | What it does                                                                                                            |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/llm/src/wrappers/hedge.ts`      | `withHedge(primary, backup)`: starts both (or the backup after `afterMs`), keeps the first to answer, closes the other. |
| 2   | `packages/llm/src/wrappers/hedge.test.ts` | Fake providers with "gates" the test opens, so each race has a known winner.                                            |
| 3   | `packages/llm/src/create.ts`              | Builds one full stack (rate limit → retry → cache → Gemini) per model and hedges them on the free tier.                 |
| 4   | `packages/llm/models.yaml`                | Adds `gemini-3.1-flash-lite`, the hedge model.                                                                          |
| 5   | `packages/llm/src/providers/gemini.ts`    | The per-call timeout default goes from 10 s to 20 s.                                                                    |
| 6   | `packages/core/src/agent/prompt.ts`       | One new rule: call `book`/`reschedule`/`cancel` right away instead of asking "shall I book it?" first.                  |

## 2. What we measured

Throwaway probe scripts sent the real system prompt, the 8 tool specs and "a table for 2 this Saturday at 7pm?" to each model, streaming. They recorded the time to the first text or tool call (TTFT). In the main run, 30 rounds called every model at the same moment, 75 s apart, on 2026-10-23 from 14:24 to 15:12 UTC. An error or a 60 s stall counts as 60 s in the percentiles.

| Model / setting                            | p50    | p90    | Errors | ≤ 1.5 s | Notes                                                                       |
| ------------------------------------------ | ------ | ------ | ------ | ------- | --------------------------------------------------------------------------- |
| `gemini-3.5-flash-lite` (old default)      | 8.1 s  | 15.3 s | 0/30   | 4/30    | Slow but never failed.                                                      |
| `gemini-3.1-flash-lite`                    | 5.6 s  | (fail) | 8/30   | 12/30   | 0.6–0.9 s when healthy; 503 "high demand" and 60 s stalls in bursts.        |
| `gemini-flash-lite-latest`                 | 4.7 s  | 19.0 s | 0/30   | 2/30    | Its own queue: often fast exactly when 3.5 Flash-Lite was slow.             |
| `gemini-3.5-flash`, thinking MINIMAL       | (fail) | (fail) | 20/30  | 4/30    | 1.2–2.2 s when it answers, but 429s after ~10 calls. Not on the price page. |
| `gemma-4-26b-a4b-it`                       | (fail) | (fail) | 16/30  | 0/30    | 3.2–4.6 s; frequent 500s.                                                   |
| **3.5 Flash-Lite + 3.1 Flash-Lite, raced** | 1.3 s  | 11.7 s | 0/30   | 15/30   | Same rounds, best of the two. What we shipped.                              |
| Raced, backup after 1.5 s                  | 2.8 s  | 13.2 s | 0/30   | 12/30   | Uses less quota, but slower at the median.                                  |

Other things we ruled out:

- **Prompt and tool size.** The system prompt is ~600 tokens and the tools add ~860. A bare "hi" with no prompt took 2.1 s once, then 8–24 s a few minutes later. Size isn't the cause.
- **Thinking.** Flash-Lite reported no thinking tokens. M6 had already found that `thinkingLevel` MINIMAL/LOW changed nothing.
- **Streaming.** The first streamed chunk arrives within a few ms of the HTTP response, and it holds the whole reply (2–5 chunks, ~40 tokens). The wait is _before_ the response starts: the request sits in Google's queue. Non-streaming wouldn't help.
- **Time of day.** We only sampled one hour. Within it, each model swung between 0.5 s and 30 s from one minute to the next, and models were slow at different moments. It looks like per-model free-tier queueing, not a daily pattern.

### Whole conversations: live evals

`pnpm eval --live` runs the 15 scenarios against real Gemini with the Ollama caller. Its latency is per turn, which is often two LLM calls (a tool call, then the reply), so it runs higher than TTFT.

| Setup                                    | Success    | Unsafe | Errored scenarios | Turn p50 / p95 |
| ---------------------------------------- | ---------- | ------ | ----------------- | -------------- |
| 3.5 Flash-Lite alone (before)            | 73.3%      | 1 ¹    | 3 (30 s timeouts) | 9.4 s / 30.4 s |
| Raced with 3.1 Flash-Lite, old prompt    | 73.3%      | 1 ¹    | 0                 | 5.4 s / 15.9 s |
| Raced, new rule (booking scenarios only) | 2/2, twice | 0      | 0                 | 2.1 s p50      |

¹ `faq-corkage-parking`: the simulated caller wandered into booking the wrong day, and the agent did what it asked through the normal read-back. It happens without the hedge too, so it's a scenario problem, not a gate bypass.

With the old prompt, the race lost both booking scenarios. 3.1 Flash-Lite tends to ask "shall I propose that booking?" before calling `book`. The system's read-back then asks again, and the simulated caller hung up between the two. A new prompt rule fixed both. The first wording ("call book as soon as you have what it needs") overshot: the agent booked the first free slot without asking which time the caller wanted. The shipped wording waits until the caller has picked an offered time: "Once the caller has picked an offered time and given their name and contact, call book right away… Never ask 'shall I book it?' yourself: the read-back asks." Because the prompt changed, the eval recordings were re-recorded (on 3.5 Flash-Lite alone, since record mode never hedges). The new baseline (`pnpm eval:ci`, 15 scenarios) is 93.3% task success, 100% handoffs correct and 0 unsafe actions, up from 86.7% / 86.7% / 0. The one failure left is `vague-this-weekend`. The FAQ scenario took two tries to record: on the first, the simulated caller ignored its goal ("you don't want to book yet") and accepted a booking, which the harness counts as unsafe.

**Conclusion: the 1.5 s p95 isn't reachable at $0.** Free-tier requests wait in a shared queue Google doesn't promise anything about. Racing two models with independent queues is the best we found: the median meets the budget, and no call failed outright.

## 3. Key concepts

- **Hedged request.** Send the same request twice and use whichever answer comes first. It's a standard trick for "tail latency", where most calls are fast and a few are very slow. It only helps if the slow ones are independent. Two calls to the _same_ model were often slow together (25 trials: p50 18 s alone, 7.5 s hedged), but two _different_ models rarely were.
- **Why race at 0 ms instead of waiting.** `afterMs` is how long the primary gets alone. 3.5 Flash-Lite was over 1.5 s in 26 of 30 rounds, so a delay saves almost no calls and adds its full length to the median. Each model has its own free quota, so racing costs nothing.
- **Stream only switches before the first chunk.** Once text has gone to the caller it can't be taken back. The loser is closed at its first chunk (`it.return()`), and an error after the first chunk is thrown as usual.
- **One stack per model.** Each model gets its own rate-limit bucket, cache and retries, so a 503 on one is retried while the other keeps going. If one fails, the race just waits for the other. If both fail, the primary's error is thrown, so a `rate_limited` "one moment" still works.
- **When the hedge is off.** Paid tier: you'd pay for both answers, and the spend cap only sees the winner's tokens. Record mode: replay answers as one model, so a recording must come from one model. `LLM_HEDGE_MODEL=none` turns it off by hand.
- **Mixing models in one conversation works.** A tool call from one model, carrying its `thoughtSignature`, was continued by the other model in both directions without errors.
- **Timeout 10 s → 20 s.** The free tier often takes 10–20 s. At 10 s a slow-but-fine turn became an `llm_unavailable` handoff. 20 s is the longest we'd make a chat caller wait before offering a human.

## 4. Potential holes and the tests that guard them

| What could go wrong                                               | Guarded by                                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| The slower model's text gets mixed into the reply                 | `hedge.test.ts` › "races both models at once and streams the first to answer"      |
| The loser keeps its connection open after losing                  | same test: `closed` is true once the loser reaches its first chunk                 |
| The backup is called even when the primary was fast               | `hedge.test.ts` › "keeps the backup idle while the primary answers within afterMs" |
| A 503 on the primary waits out `afterMs` before trying the backup | `hedge.test.ts` › "starts the backup at once when the primary fails early"         |
| One model's error ends a turn the other could have answered       | `hedge.test.ts` › "waits for the other model when one fails…"                      |
| A half-streamed reply restarts on the other model                 | `hedge.test.ts` › "does not switch models once a chunk was streamed"               |
| The hedge runs on the paid tier or while recording                | `create.test.ts` › "hedge › is off for the paid tier / record mode"                |
| A typo in `LLM_HEDGE_MODEL` quietly turns the hedge off           | `create.test.ts` › "rejects invalid env"                                           |

## 5. Quiz

1. Why didn't a shorter system prompt fix the 14 s first token?
2. What is a hedged request, and when does it _not_ help?
3. Why does the shipped hedge start both models at once instead of waiting 1.5 s?
4. Why is the hedge turned off on the paid tier?
5. Why is it turned off in `pnpm eval --record`?
6. The primary has streamed "Sure, I" and then fails. What does the caller get?
7. Both models fail: the primary with `rate_limited`, the backup with a 503. Which error reaches the agent loop, and why does that matter?
8. Why was the default timeout raised instead of lowered?

<details>
<summary>Answers</summary>

1. The time is spent waiting in Google's free-tier queue before the model starts. A bare "hi" with no prompt was just as slow.
2. Send the same request twice and take the first answer. It doesn't help when both copies are slow for the same reason, like two calls to one overloaded model.
3. The primary was slower than 1.5 s in 26 of 30 rounds, so waiting saves almost no calls and adds 1.5 s to most turns. Each model has its own free quota, so the extra call is free.
4. You'd pay for both calls, and the spend cap only counts the winner's tokens, so it would undercount.
5. Replay answers as the one model in the manifest. A recording mixing two models' answers wouldn't replay.
6. The error. Text already sent can't be taken back, so the stream doesn't switch models after its first chunk.
7. The primary's `rate_limited`. The loop says "one moment", waits `retryAfterMs` and tries again, and that only works if it sees the rate limit.
8. Free-tier calls often take 10–20 s and then answer fine. A 10 s timeout turned those into handoffs. The hedge, not the timeout, is what makes turns faster.

</details>
