/** What came of a handoff (spec §12), in the order the resolve form offers them. */
export const HANDOFF_OUTCOMES = {
  booked_by_staff: "Staff booked it",
  resolved_no_booking: "Resolved, no booking",
  caller_unreachable: "Couldn't reach caller",
  not_needed: "Handoff wasn't needed",
} as const;

export type HandoffOutcome = keyof typeof HANDOFF_OUTCOMES;

export const outcomeLabel = (o: string | null): string | null =>
  o && o in HANDOFF_OUTCOMES ? HANDOFF_OUTCOMES[o as HandoffOutcome] : null;
