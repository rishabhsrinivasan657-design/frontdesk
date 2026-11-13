/**
 * Rewrites unambiguous 24-hour times ("19:30", "00:00", "12:00") in text meant for a guest as
 * "7:30 PM". Hours 1 to 11 stay as written: "7:30" could be either, and guessing AM at a
 * dinner restaurant would be worse than leaving it. Timestamps, seconds and times that
 * already say AM or PM are left alone.
 */
export function twelveHourTimes(text: string): string {
  return text.replace(
    /(?<![\d:T])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])(?!\s?[AaPp]\.?[Mm])/g,
    (match, h: string, m: string) => {
      const hour = Number(h);
      if (hour >= 1 && hour <= 11) return match;
      return `${hour % 12 === 0 ? 12 : hour % 12}:${m} ${hour < 12 ? "AM" : "PM"}`;
    },
  );
}
