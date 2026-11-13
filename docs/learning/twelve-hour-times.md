# Saying "7:00 PM" instead of "19:00"

## The problem

Guests heard the agent say things like "we're open from 12:00 to 21:00". The screens were
already fine (the booking card and calendar pane show "7:00 PM"), so the 24-hour times came
from the model itself. It reads the opening hours and slot times as `"HH:mm"` (that is how
`businesses/casa-fiorella.yaml` and `findSlots` store them) and repeats them back.

## Why we didn't just change the prompt

The obvious fix is to tell the model "say times the 12-hour way". But the eval recordings
(`packages/evals/recordings/`) are keyed by a hash of the exact request. Changing the prompt
makes **every** recording stale, and re-recording costs Gemini quota. Even changing only the
agent's reply text would break the caller-simulator recordings that quote it (one of them,
`off-topic-chatter`, runs in CI).

So the agent's own data and history stay exactly as they were, and the fix runs at the edge
instead: where the API sends a reply to the browser.

## The fix

- `packages/core/src/text/twelve-hour.ts`: `twelveHourTimes(text)` rewrites unambiguous
  24-hour times: `21:00 → 9:00 PM`, `12:00 → 12:00 PM`, `00:00 → 12:00 AM`.
- It **leaves 1:00–11:59 alone**. "7:30" at a dinner restaurant almost always means evening;
  guessing "7:30 AM" would be worse than leaving it.
- It skips timestamps (`2026-11-08T19:00`), times with seconds, and times that already say AM/PM.
- `apps/api/src/chat/connection.ts` applies it to every `agent_sentence` and to agent lines in
  a resumed transcript. The voice speaks the same text, so it says "nine PM" too.

The grounding check still runs on the model's original draft before any of this, and it already
understood both forms ("9 pm" and "21:00" are the same claim).

## Quiz yourself

1. Why does changing the prompt make the eval recordings stale?
2. Why does `twelveHourTimes` refuse to touch "7:30"?
3. The owner dashboard transcript still shows "21:00". Why is that okay, and where would you
   change it if it weren't?
