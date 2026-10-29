# Running the pilot

The pilot is Front Desk answering real people, with every conversation recorded under `source=pilot` (spec §12, §14 M10). This page covers four things:

- finding a restaurant
- the weekly routine
- comparing real numbers with the evals
- the manual privacy chores

Setup is in `docs/deploy.md`.

## Finding a restaurant (you)

**Try first:** a real local restaurant, for a few weeks, at no cost to them. Calls stay with their staff; Front Desk only takes web bookings on a calendar they can see.

A short script for the owner or manager, in a quiet hour (mid-afternoon):

1. **The pitch:** "I built an AI receptionist that takes table bookings from a web page, any time, and puts them on a Google Calendar you can see. It always reads the booking back and asks before saving, and it hands anything tricky to you."
2. **The ask:** "Could I run it for you for free for a month? You'd get every booking by email and calendar, and you can switch it off any time."
3. **What they'd provide:**
   - their hours, tables and policies (about 15 minutes)
   - a Google account for the calendar
   - one link on their website or Instagram
4. **What you promise:**
   - no cost
   - no access to their systems
   - guests' details are deleted after 30 days
   - they can see every conversation on the dashboard

A real restaurant needs its own business config (`businesses/<name>.yaml`) and its own Google calendar. Plan that as a follow-up with Claude before going live for them.

**Fallback (the default until then):** the public Casa Fiorella demo. Share the `/talk` link with friends, classmates, or a Discord or Reddit thread asking for testers. Say it's a demo: bookings land on a demo calendar and no restaurant exists.

## The weekly routine (Mondays, about 30 minutes)

1. **Release.** On `main`, with nothing uncommitted:

   ```bash
   git switch main && git pull
   pnpm release
   ```

   It tags `vYYYY.MM.DD` and prepends the week's section to `CHANGELOG.md`. It never pushes. Read the section, then push it:

   ```bash
   git push origin main <tag>
   ```

2. **Deploy it.** On the VM:

   ```bash
   cd /opt/frontdesk/app && deploy/deploy.sh <tag>
   ```

   Then, from your Mac:

   ```bash
   pnpm smoke https://<your-site>
   ```

3. **Read the feedback:** open `/dashboard/feedback?source=pilot`. Low ratings first: open the conversation and note what went wrong.
4. **Clear the handoffs:** open `/dashboard/handoffs?source=pilot`. For each one, do what the guest needed, then resolve it with a note and the honest outcome. **"Handoff wasn't needed"** is the important one: it marks a handoff the agent could have handled.
5. **Write down the top 3 issues** of the week (a line each in a GitHub issue or your notes).
6. **Turn each real failure into an eval scenario** in `packages/evals/scenarios/`. A real caller's mistake becomes a regression test before you fix it. Ask Claude to do this from the conversation's transcript, with names changed.

## Real vs simulated numbers

The evals run scripted callers against recordings. The pilot has real people. They answer the same questions in different ways:

| Question                 | Pilot (`/dashboard/metrics?source=pilot`)                                                                     | Evals (`pnpm eval:targets`)                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Did it get the job done? | **Task success**: conversations with a confirmed booking and no handoff                                       | **Task success %**: the calendar ends exactly as expected (target 90%) |
| Did it hand off well?    | **Handoff rate**, plus resolved outcomes. "Handoff wasn't needed" ÷ resolved handoffs = the unnecessary share | **Handoff accuracy** (target 95%), with missed and unnecessary counts  |
| Was it safe?             | Every write is in the audit log (Conversations → a conversation → audit trail)                                | **Unsafe actions**: must be 0                                          |
| Was it fast?             | **Latency** p50/p95 against the §8 budget                                                                     | p50/p95 (a warning only; replay timings aren't real)                   |
| Did people like it?      | **Guest rating** (1–5) and comments                                                                           | No equivalent: only the pilot can tell you this                        |

How to read the gaps:

- **The pilot's success is much lower than the eval's:** real callers do something the scenarios don't. The low-rated conversations show what; add scenarios for it.
- **The unnecessary-handoff share is much higher than the eval's unnecessary count:** the agent is too cautious with real phrasing. Look at the handoff reasons.
- **The pilot looks better than the evals:** probably too few conversations yet. Don't conclude anything from fewer than about 30.

Numbers under **Pilot** never include demo (seeded) or eval data, so the two are never mixed (spec §10).

## Privacy chores

- **Automatic:** every night at 04:00 New York, the worker redacts pilot names, contacts, notes and chat text older than 30 days. It also redacts demo-calendar bookings 30 days after their date.
- **Monthly, by hand (you):**
  1. Open the demo Gmail account and search `in:sent older_than:30d`.
  2. Select all, then delete.
  3. Empty the Trash.

  The app can only send mail, so it can't do this for you.

- **Backups** on the VM delete themselves after 3 days, so a copy outlasts the 30 days by at most 3 days (stated on `/privacy`).
- **Deletion requests:** if someone asks, find their conversation on the dashboard and note its id. There's no one-click early delete yet, so ask Claude to add one. Until then their data is gone within 30 days anyway.

## Staying at $0

- Once a month, check <https://aistudio.google.com>: the project is on the **Free tier** with no billing account.
- In the Oracle console, **Billing** → **Cost analysis** should show $0. Never upgrade the account.
- The free tier allows about 500 Gemini requests a day. The chat limits keep the whole site under that (200 turns a day). If real demand ever hits it, guests get "please call the restaurant", never a bill.
