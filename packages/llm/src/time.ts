const PACIFIC = "America/Los_Angeles";
const DAY_MS = 86_400_000;

const pacificParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: PACIFIC,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parts(nowMs: number): Record<string, string> {
  return Object.fromEntries(pacificParts.formatToParts(nowMs).map((p) => [p.type, p.value]));
}

/** The Pacific calendar date; Gemini's requests-per-day quota resets at midnight Pacific. */
export function pacificDay(nowMs: number): string {
  const p = parts(nowMs);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Milliseconds until the next Pacific midnight (assumes a 24 h day; DST days are off by ≤ 1 h). */
export function msUntilPacificMidnight(nowMs: number): number {
  const p = parts(nowMs);
  const elapsed =
    (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second)) * 1000 + (nowMs % 1000);
  return DAY_MS - elapsed;
}

/** The UTC calendar month, `YYYY-MM`, used to key monthly spend. */
export function utcMonth(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}
