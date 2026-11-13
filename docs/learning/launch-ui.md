# The orb and the calendar pane (learning guide)

For the launch demo, the guest page (`/talk`) became voice-first. A floating orb sits alone on the page. When you speak or type, a conversation pane slides in, and when a booking is written, a calendar pane slides in and shows the slot that was just saved. This note covers the one backend change it needed and the rules the animations follow.

## 1. Reading order

| #   | File                                             | What it does                                                                                                |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 1   | `packages/core/src/agent/types.ts`               | `CardDetails`: the pending action's slot as display labels (date, time, party, name, nearby seating times). |
| 2   | `packages/core/src/gate/summary.ts`              | `cardDetails()`, next to `readBack()`: built from the same data, in the business timezone.                  |
| 3   | `packages/core/src/gate/propose.ts`              | Stores `details` on the pending action along with `summary`.                                                |
| 4   | `packages/core/src/protocol/messages.ts`         | `pending_action` (and a resumed `session`) carry an optional `details`.                                     |
| 5   | `apps/web/src/components/talk/orb-state.ts`      | `orbState()`: idle, listening, thinking, speaking or unavailable, from real signals only.                   |
| 6   | `apps/web/src/voice/use-voice.ts`                | `agentSpeaking` (added by the hands-free work): the speaker's start and stop events, which the orb follows. |
| 7   | `apps/web/src/components/talk/orb.tsx`           | The orb button, the hands-free pill and the live transcript.                                                |
| 8   | `apps/web/src/components/talk/calendar-pane.tsx` | The booked slot on the restaurant's evening, with honest checkmarks.                                        |
| 9   | `apps/web/src/components/chat/chat-window.tsx`   | The three-pane layout and when each pane appears.                                                           |
| 10  | `apps/web/src/app/globals.css`                   | The `fd-*` animations and the warmer palette.                                                               |

## 2. Concepts

- **The server sends data, not just a sentence.** Before this change, the booking card only got the read-back sentence. To draw the calendar we needed the date, time and party size. Parsing them out of the sentence would be fragile, so `cardDetails()` builds them from the same `slot` and `reservation` that `readBack()` uses. Like the read-back, they never come from the LLM.
- **Labels are made on the server.** Times are formatted in the restaurant's timezone, so a guest in another timezone still sees the restaurant's 7:00 PM. The browser does no date maths.
- **Nearby times are real.** `times` comes from `localWallTimesOnGrid`, the same seating grid availability uses. Near opening, the window starts at the first seating instead of centring. The pane doesn't draw other guests' bookings, because the page doesn't know them (and shouldn't).
- **Optional on the wire.** `details` is optional in the protocol, so a pending action stored before this change still parses and the card falls back to the sentence.
- **Animations follow state.** The orb has five looks, and each maps to a real signal: the open microphone, the speaker playing, or a turn running. Listening wins, because tapping during a reply is barge-in. `orbState()` is a pure function with its own test.
- **A still click target.** The orb's floating motion is on an inner `span`, not the `<button>`. A button that moves never counts as "stable" to Playwright (the voice tests failed on exactly this), and a drifting click target is bad UX too.
- **Checkmarks are claims.** The calendar pane only ticks what the code really did: the guest confirmed, the slot was re-checked and saved, and the action was audited. It doesn't claim an email was sent, because that depends on the contact the guest gave.
- **Keep the test ids.** The layout changed completely, but every `data-testid` the e2e tests use stayed, so the 22 browser tests checked the new UI without being rewritten.

## 3. Quiz

1. Why does `cardDetails()` live next to `readBack()` instead of in the browser?
2. A guest in London books 7:00 PM at a New York restaurant. Which time does the calendar pane show, and which code makes that so?
3. The receptionist's reply has finished streaming, but it's still being read aloud. What does the orb show, and why?
4. Why isn't "Confirmation email queued" one of the checkmarks?

<details><summary>Answers</summary>

1. Both are built from the gate's data (`slot`, `reservation`, `args`), never the LLM's words, so the card and the read-back can't disagree. The browser would have to re-parse text or re-implement timezone rules.
2. 7:00 PM, the restaurant's time. `cardDetails()` formats with `config.business.timezone`, and the browser only displays the label.
3. Speaking: `orbState()` checks `speaking` (fed from `agentSpeaking`) before `busy`, and the speaker reports playing until its queue is empty.
4. An email is only sent when the guest gave an email address. The pane doesn't know which contact was given, so it doesn't claim it.

</details>
