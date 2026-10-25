/** The restaurant's timezone: every time the owner sees is local to Casa Fiorella. */
export const BUSINESS_TZ = process.env.NEXT_PUBLIC_BUSINESS_TZ ?? "America/New_York";

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function formatPct(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "—";
  const pct = rate * 100;
  return `${Number.isInteger(Math.round(pct * 10) / 10) ? Math.round(pct) : pct.toFixed(1)}%`;
}

/** Fractions of a cent keep two significant digits: free-tier turns cost very little. */
export function formatUsd(usd: number): string {
  if (usd === 0 || usd >= 0.01) return `$${usd.toFixed(2)}`;
  return `$${usd.toPrecision(2)}`;
}

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export const formatTime = (iso: string): string => timeFormat.format(new Date(iso));

const clockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  hour: "numeric",
  minute: "2-digit",
});

export const formatClock = (iso: string): string => clockFormat.format(new Date(iso));

/** A YYYY-MM-DD calendar day (already local) as "Nov 7". */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(`${day}T00:00:00Z`));
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

const wallFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Slot ids start with the restaurant's local wall time ("2026-11-07T19:00@t4-1#4"). */
export function formatSlot(slotId: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(slotId);
  if (!m) return slotId;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  return wallFormat.format(new Date(Date.UTC(y, mo - 1, d, h, mi)));
}
