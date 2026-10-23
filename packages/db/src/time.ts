/** Postgres renders timestamptz as "2026-11-06 23:00:00+00"; the app speaks ISO 8601. */
export const iso = (value: string): string => new Date(value).toISOString();
export const isoOrNull = (value: string | null): string | null => (value ? iso(value) : null);
