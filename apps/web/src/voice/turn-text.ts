/**
 * Does a transcript *sound* finished? The endpointer uses this to choose how long to wait after
 * the caller goes quiet: briefly after "yes, that's right", longer after "a table for…".
 * Deterministic rules for a restaurant line, not a model: cheap, testable and explainable.
 */
export type Completeness = "complete" | "incomplete" | "neutral";

/** Whole answers that end a turn on their own. */
const SHORT_ANSWERS = new Set([
  "yes",
  "yeah",
  "yep",
  "yes please",
  "no",
  "nope",
  "no thanks",
  "no thank you",
  "that's right",
  "thats right",
  "correct",
  "thank you",
  "thanks",
  "sure",
  "ok",
  "okay",
  "perfect",
  "great",
  "sounds good",
  "cancel it",
  "that's all",
  "that's it",
  "bye",
  "goodbye",
]);

/** A last word that promises more: prepositions, articles, conjunctions, fillers, auxiliaries. */
const DANGLING = new Set([
  "for", "at", "on", "in", "to", "of", "with", "from", "about", "around", "by", "until",
  "and", "or", "but", "so", "because", "if", "then",
  "the", "a", "an", "my", "our", "your", "some",
  "um", "uh", "er", "erm", "hmm", "like",
  "is", "are", "was", "be", "can", "could", "would", "will", "should", "i'd", "i'm", "i", "we",
  "we're", "it's", "maybe", "just",
]); // prettier-ignore

export function turnCompleteness(text: string): Completeness {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "incomplete";
  const joined = words.join(" ");
  if (SHORT_ANSWERS.has(joined)) return "complete";
  if (DANGLING.has(words.at(-1)!)) return "incomplete";
  // "my name is Ana Lopez": a name after the lead-in is a whole answer.
  if (/\bname is \S+/.test(joined)) return "complete";
  // Longer requests ("a table for 4 on Friday…") stay neutral even when they sound whole: a
  // breath before "at seven" is common, and 300 ms would cut it off.
  return "neutral";
}
