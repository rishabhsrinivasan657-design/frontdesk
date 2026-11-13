# Launch UI designs

Clickable mockups agreed with the owner on 2026-11-12. They're standalone HTML files with fake data and no backend. To view one, serve this folder (`python3 -m http.server` here) and open the file. The animations need a page served over HTTP, not a file opened from disk.

## `orb-mockup.html`: the guest page (built in PR #30)

The orb alone → the conversation pane slides in on the first message → the calendar pane slides in once a booking is written.

## `dashboard-mockup.html`: the owner dashboard (built in PR #30)

**Agreed:**

- **Today is the home page:** a vertical day calendar, like Google Calendar's day view.
  - Time runs down the left at about 120 px per hour. There's one roomy column per table, and filter chips for 2-, 4- and 6-tops.
  - Booking cards show the name, time range, party size and source. Clicking one opens its details.
  - Above the calendar: KPI cards (live now, bookings tonight, guests expected against seats, busiest time, needs you) and a week strip.
  - Below the calendar: "Live now" and "Needs you".
  - The owner rejected a horizontal timeline as cramped.
- **Handoffs:** one card per open handoff, showing:
  - the reason badge, the channel and when it arrived
  - the guest's name and contact
  - "What they want", fact chips, and "What you need to do" (a fixed sentence per reason)
  - the transcript, folded away
  - notes and the four outcome buttons
- **Metrics:** three sections. "Is it doing the job?", "What does it cost to run?" (paid-price estimate next to the $0.00 actually spent) and "How fast is it?" (each stage against its budget). The trend charts stay.
- **Feedback and Conversations:** unchanged apart from styling.

**Backend (as built):**

1. `GET /owner/calendar?date=`: that day's reservations from the calendar adapter's `listReservations`, joined to Front Desk's booking log (conversation, voice or chat, email). It also returns the tables, opening hours and a 7-day strip.
   - **Correction to the mockup:** the calendar adapter only reads events Front Desk created (they carry a private Front Desk marker), so bookings staff add by hand in Google Calendar are not visible. They aren't visible to availability either. The "added by staff" colour was dropped; cards show voice or chat instead. Reading hand-made events is a follow-up that touches availability too.
2. Handoff tickets store the guest's name and contact, plus the requested date, time and party when the session knew them (`handoffDetails()` in core; migration 0005; wiped by retention). Seeded demo handoffs have none.
3. A count of unsafe actions from the audit trail (an `executed` entry without a `confirmed` one before it). It should always be 0.
4. Seats and tables for "guests expected" come from the business config (`seating.tables`).
