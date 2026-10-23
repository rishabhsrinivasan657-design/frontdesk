/**
 * JSON that keeps Dates. Plain JSON turns a `Booking.start` into a string, and the gate's
 * re-check after a reconnect would then compare a string to a Date.
 */
const DATE_TAG = "$date";

export function encode(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key, v: unknown) {
    // `toJSON` has already run on `v`; the raw value is still on the holder.
    const raw = this[key];
    return raw instanceof Date ? { [DATE_TAG]: raw.toISOString() } : v;
  });
}

export function decode<T>(text: string): T {
  return JSON.parse(text, (_key, v: unknown) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const keys = Object.keys(v);
      const tagged = (v as Record<string, unknown>)[DATE_TAG];
      if (keys.length === 1 && typeof tagged === "string") return new Date(tagged);
    }
    return v;
  }) as T;
}
