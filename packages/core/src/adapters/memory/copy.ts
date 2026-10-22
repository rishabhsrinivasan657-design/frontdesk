/** Deep copy of plain data (objects, arrays, Dates), so stored state never aliases caller objects. */
export function deepCopy<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => deepCopy(v)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, deepCopy(v as unknown)]),
    ) as T;
  }
  return value;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    for (const v of Object.values(value)) deepFreeze(v as unknown);
    Object.freeze(value);
  }
  return value;
}
