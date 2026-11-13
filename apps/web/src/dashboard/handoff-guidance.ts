/** "What you need to do" on a handoff card: one fixed sentence per reason (never generated). */
const NEXT_STEP: Record<string, string> = {
  party_too_large:
    "Online booking stops at the agent's party limit. Call them back to arrange a larger table.",
  private_event:
    "They want a private event. Call or email them to talk through dates, space and menu.",
  allergy_safety:
    "Front Desk never gives allergy advice. Check with the kitchen, then call them back before they book.",
  complaint: "They had a bad experience. Reach out personally, listen, and make it right.",
  human_requested: "They asked for a person. Call or email them back.",
  late_change:
    "They want to change a booking inside the no-changes window. Decide whether you can, then let them know.",
  low_confidence:
    "Front Desk wasn't sure it understood. Read the conversation and follow up with the guest.",
  tool_failures: "Front Desk's tools kept failing mid-conversation. Finish their request by hand.",
  grounding_failed:
    "Front Desk couldn't back up an answer with your data, so it stopped. Answer their question yourself.",
  rate_limited: "The AI service was busy. Finish their request by hand.",
  llm_unavailable: "The AI service was down. Finish their request by hand.",
  calendar_unavailable:
    "The calendar couldn't be reached, so nothing was booked. Book it for them once it's back.",
  email_failed:
    "The booking is made, but the confirmation email never arrived. Send it or call to confirm.",
};

export function nextStep(reason: string): string {
  return NEXT_STEP[reason] ?? "Read the conversation and follow up with the guest.";
}

const FALLBACK = /^Handoff \([^)]*\) after: /;

/** The model's summary when it wrote one; else the guest's last words, shown as a quote. */
export function whatTheyWant(summary: string): { kind: "summary" | "quote"; text: string } {
  return FALLBACK.test(summary)
    ? { kind: "quote", text: summary.replace(FALLBACK, "") }
    : { kind: "summary", text: summary };
}
