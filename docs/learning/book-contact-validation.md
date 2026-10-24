# Book contact validation: "contact Dev Shah" (learning guide)

A live `faq-corkage-parking` run on 2026-10-24 read back "a table for 2 … under Dev Shah, contact Dev Shah". The agent had put the caller's name in `contact`, and nothing stopped it. The booking had no phone number or email, so nobody could confirm or find it later. This note covers why it got through and the one-line rule that now rejects it.

## 1. Reading order

| #   | File                                            | What it does                                                                                    |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | `packages/core/src/agent/tools/schemas.ts`      | `bookingContact`: the `book` tool's `contact` must be an email or a phone number (7–15 digits). |
| 2   | `packages/core/src/gate/propose.ts`             | Unchanged. `TOOL_ARGS.book.safeParse` already turns a failed rule into `invalid_args`.          |
| 3   | `packages/core/src/agent/tools/schemas.test.ts` | Which contacts pass and which don't.                                                            |
| 4   | `packages/core/src/gate/propose.test.ts`        | "rejects a book whose contact is the caller's name…": no pending action is stored.              |

## 2. What was wrong

`contact` was `z.string().trim().min(3).max(100)`. Any three characters passed, including a name. The JSON schema the LLM sees says "Email or phone number", but a description is a hint, not a check. The model is free to ignore it, and here it did.

The fix adds a Zod `.refine` to `book`'s `contact`. It accepts:

- an email: `something@something.something` with no spaces, or
- a phone number: only digits, spaces, `+ ( ) . -`, with 7 to 15 digits (15 is the international maximum).

When the rule fails, `propose` returns `invalid_args` and the message "contact must be the caller's phone number or email; ask the caller for one". The agent reads that tool result and asks. No read-back happens, so the caller is never asked to confirm a booking nobody could reach.

`find_reservation` keeps the loose rule on purpose. A lookup with a name in `contact` just finds nothing (`normalizeContact` turns "Ana" into `""`, which matches no booking), so the agent asks again. It never writes anything.

## 3. Key concepts

- **Validate at the gate, not in the prompt.** The prompt and tool description tell the model what we want. The gate makes sure it actually happens. LLM output is untrusted input, just like a web form.
- **`.refine` does not change the JSON schema.** `z.toJSONSchema` drops custom refinements, so the tool spec sent to Gemini is byte-for-byte the same as before. That kept the other 14 eval scenarios' recordings valid.
- **Why one recording still had to change.** The old `faq-corkage-parking` recording contained the bad `book` call. On replay, the gate now answers it with `invalid_args`, so the next request differs and its recording is `missing`. Only the `faq` category was re-recorded (`LLM_TIMEOUT_MS=60000 pnpm eval --record --filter faq`), and the 33 files the new run no longer used were deleted.
- **The simulated caller is flaky.** In 2 of 3 record attempts, `gemma3:4b` ignored "you don't want to book yet", picked a time and gave a real contact. The agent did ask for a phone or email both times. The third run stayed on goal (corkage $25/bottle, street parking and a garage) and was kept. The baseline didn't move: 93.3% success, 100% handoffs correct, 0 unsafe.

## 4. Potential holes and the tests that guard them

| What could go wrong                                         | Guarded by                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| A name, a word or too few digits passes as a contact        | `schemas.test.ts` › "book contact › rejects …"                           |
| Real formats get rejected (`+1 (555) 123-4567`, UK numbers) | `schemas.test.ts` › "book contact › accepts …"                           |
| The gate stores a pending booking with a bad contact        | `propose.test.ts` › "rejects a book whose contact is the caller's name…" |
| A new rule silently changes the tool specs                  | the eval recordings: a changed spec makes `pnpm eval:ci` report `stale`  |

## 5. Quiz

1. The tool description already said "Email or phone number". Why wasn't that enough?
2. Why did adding `.refine` not force a full re-record of all 15 scenarios?
3. Why does `find_reservation` still accept a name in `contact`?
4. What does the agent see when `book` is rejected, and what should it do next?

### Answers

1. A description only guides the model, and the model can ignore it. Only the gate's validation is enforced.
2. Refinements aren't part of the JSON schema, so every request to Gemini stayed the same. Only the scenario that actually made the bad call took a different path.
3. It only reads. A bad contact matches nothing, so the worst case is "no reservation found", and the agent asks again.
4. A failed tool result, `invalid_args`, with "ask the caller for one". It should ask the caller for a phone number or email, then call `book` again.
