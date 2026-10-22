/** Spec §6 prompt injection: caller text is data, never instructions. */

const DELIMITERS = /<\/?\s*(caller_message|pending_request)[^>]*>/gi;

/** Removes anything that could open or close a delimiter block early. */
export function stripDelimiters(text: string): string {
  return text.replace(DELIMITERS, "");
}

/** The caller's text as one untrusted block for the model. */
export function wrapCallerText(text: string): string {
  return `<caller_message>\n${stripDelimiters(text)}\n</caller_message>`;
}

const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above) instructions/i,
  /system prompt/i,
  /you are now/i,
  /developer mode/i,
  /skip (the )?confirm/i,
  /already confirmed/i,
  /^\s*(system|assistant)\s*:/i,
];

/** Known injection phrasing, flagged in the turn record. The gate makes it inert either way. */
export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

const ASK_FOR_HUMAN =
  /\b(speak|talk|connect|transfer)\b.*\b(human|person|manager|someone|staff|representative)\b/i;
const HUMAN_ALONE = /^\s*(human|agent|representative|operator)\s*[.!?]*\s*$/i;

/** The caller asked for a person: handed off at once, without the model (trigger human_requested). */
export function wantsHuman(text: string): boolean {
  return ASK_FOR_HUMAN.test(text) || HUMAN_ALONE.test(text);
}
