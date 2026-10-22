/** Makes a fresh id with the given prefix, e.g. "turn" → "turn_7". Injected: core has no crypto. */
export type IdGenerator = (prefix: string) => string;
