/** Spec §6 prompt injection: caller text is data, never instructions. */

/**
 * Replaces every angle bracket (and fullwidth lookalike) so no tag can be formed or closed
 * inside a delimited block, whatever spelling, spacing or nesting the text uses.
 */
export function escapeAngles(text: string): string {
  return text.replace(/[<＜﹤]/g, "‹").replace(/[>＞﹥]/g, "›");
}

/** The caller's text as one untrusted block for the model. */
export function wrapCallerText(text: string): string {
  return `<caller_message>\n${escapeAngles(text)}\n</caller_message>`;
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

const PERSON = String.raw`(?:a |an |the |some |your )?(?:real |actual |live )?(?:human|person|manager|someone|somebody|staff|representative|operator)\b`;
const ASK_FOR_HUMAN = [
  new RegExp(String.raw`\b(?:speak|talk)\s+(?:to|with)\s+${PERSON}`, "i"),
  new RegExp(
    String.raw`\b(?:connect|transfer|put)\s+me\s+(?:through\s+)?(?:to|with)\s+${PERSON}`,
    "i",
  ),
  /\b(?:a|an)\s+(?:real\s+|actual\s+|live\s+)?(?:human|person)\s*(?:please)?\s*[.!?]*\s*$/i,
  /^\s*(?:real\s+person|human|agent|representative|operator)(?:\s+please)?\s*[.!?]*\s*$/i,
];

/** The caller asked for a person: handed off at once, without the model (trigger human_requested). */
export function wantsHuman(text: string): boolean {
  return ASK_FOR_HUMAN.some((re) => re.test(text));
}
