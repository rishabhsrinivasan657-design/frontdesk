import type { IdGenerator } from "../../ports/ids.js";

/** `${prefix}_${n}` with one counter per prefix, starting at 1. Deterministic for tests and evals. */
export function sequentialIds(): IdGenerator {
  const counters = new Map<string, number>();
  return (prefix) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}_${n}`;
  };
}
