/** Pure helpers for the owner's day calendar (the dashboard's home page). */

export const STEP_MINUTES = 15;

type Span = { startMinute: number; endMinute: number };
type Range = { from: number; to: number };

/** "t4-2" → "4-top · 2", the way staff name tables. */
export function tableLabel(id: string): string {
  const m = /^t(\d+)-(\d+)$/.exec(id);
  return m ? `${m[1]}-top · ${m[2]}` : id;
}

/** Minutes since midnight → "5:00 PM". */
export function minuteLabel(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const toMinute = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** The hours the calendar shows: opening hours plus any booking outside them, to whole hours. */
export function visibleRange(
  hours: { open: string; close: string }[],
  reservations: Span[],
): Range {
  const starts = [...hours.map((h) => toMinute(h.open)), ...reservations.map((r) => r.startMinute)];
  const ends = [...hours.map((h) => toMinute(h.close)), ...reservations.map((r) => r.endMinute)];
  if (starts.length === 0) return { from: 17 * 60, to: 23 * 60 };
  return {
    from: Math.floor(Math.min(...starts) / 60) * 60,
    to: Math.min(24 * 60, Math.ceil(Math.max(...ends) / 60) * 60),
  };
}

/** Tables in use at the start of each 15 minutes in the range. */
export function occupancy(
  reservations: Span[],
  range: Range,
): { minute: number; tables: number }[] {
  const out: { minute: number; tables: number }[] = [];
  for (let minute = range.from; minute < range.to; minute += STEP_MINUTES) {
    out.push({
      minute,
      tables: reservations.filter((r) => r.startMinute <= minute && minute < r.endMinute).length,
    });
  }
  return out;
}

/** The first 15 minutes with the most tables in use, or null on an empty day. */
export function busiest(
  reservations: Span[],
  range: Range,
): { minute: number; tables: number } | null {
  let best: { minute: number; tables: number } | null = null;
  for (const o of occupancy(reservations, range)) {
    if (o.tables > 0 && (!best || o.tables > best.tables)) best = o;
  }
  return best;
}
