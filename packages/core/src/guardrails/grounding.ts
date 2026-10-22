import { DateTime } from "luxon";
import type { SessionState } from "../agent/types.js";
import { DAY_KEYS, type BusinessConfig, minutesOfDay } from "../config/schema.js";

/**
 * Grounding post-check (spec §6): times, dates, prices and policy numbers in a draft reply
 * must come from config, tool results this session, or the caller's own words.
 */

export type ClaimKind = "time" | "date" | "price" | "number";
export interface Claim {
  kind: ClaimKind;
  value: string;
  raw: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

/** Each pattern consumes its matches so later patterns can't re-read them. */
const PATTERNS: {
  kind: ClaimKind;
  re: RegExp;
  value: (m: RegExpExecArray) => string | undefined;
}[] = [
  {
    kind: "time",
    re: /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])(?:\.\s?m\.|\s?m\b)/gi,
    value: (m) => {
      const h = (Number(m[1]) % 12) + (m[3]!.toLowerCase() === "p" ? 12 : 0);
      return hhmm(h, Number(m[2] ?? 0));
    },
  },
  { kind: "time", re: /\bnoon\b/gi, value: () => "12:00" },
  { kind: "time", re: /\bmidnight\b/gi, value: () => "00:00" },
  { kind: "date", re: /\b\d{4}-(\d{2})-(\d{2})\b/g, value: (m) => `${m[1]}-${m[2]}` },
  {
    kind: "time",
    re: /\b([01]?\d|2[0-3]):([0-5]\d)\b/g,
    value: (m) => hhmm(Number(m[1]), Number(m[2])),
  },
  {
    kind: "date",
    re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+([0-3]?\d)(?:st|nd|rd|th)?\b/gi,
    value: (m) => {
      const day = Number(m[2]);
      if (day < 1 || day > 31) return undefined;
      return `${pad(MONTHS.indexOf(m[1]!.toLowerCase()) + 1)}-${pad(day)}`;
    },
  },
  { kind: "price", re: /\$\s?(\d+(?:\.\d{1,2})?)/g, value: (m) => String(Number(m[1])) },
  {
    kind: "price",
    re: /\b(\d+(?:\.\d{1,2})?)\s*(?:dollars|usd)\b/gi,
    value: (m) => String(Number(m[1])),
  },
  {
    kind: "number",
    re: /\b(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|people|persons|guests|seats)\b/gi,
    value: (m) => `${Number(m[1])} ${unitOf(m[2]!)}`,
  },
];

/** Numbers are compared with their unit: a 6-top table doesn't ground "6 hours". */
type Unit = "min" | "h" | "d" | "w" | "people";
function unitOf(word: string): Unit {
  const w = word.toLowerCase();
  if (w.startsWith("min")) return "min";
  if (w.startsWith("h")) return "h";
  if (w.startsWith("d")) return "d";
  if (w.startsWith("w")) return "w";
  return "people";
}

export function extractClaims(text: string): Claim[] {
  let rest = text;
  const claims: Claim[] = [];
  for (const { kind, re, value } of PATTERNS) {
    rest = rest.replace(re, (...args: unknown[]) => {
      const match = args.slice(0, -2) as unknown as RegExpExecArray;
      const v = value(match);
      if (v !== undefined) claims.push({ kind, value: v, raw: match[0].trim() });
      return " ".repeat(match[0].length);
    });
  }
  return claims;
}

/** Every value the agent may state this session, as `${kind}:${value}`. */
export function buildFacts(config: BusinessConfig, session: SessionState, now: Date): Set<string> {
  const zone = config.business.timezone;
  const facts = new Set<string>(session.callerValues);
  const add = (kind: ClaimKind, value: string | number) => facts.add(`${kind}:${value}`);
  const addNumber = (n: number, unit: Unit) => {
    add("number", `${n} ${unit}`);
    if (unit === "min" && n % 60 === 0) add("number", `${n / 60} h`);
    if (unit === "h") add("number", `${n * 60} min`);
    if (unit === "d" && n % 7 === 0) add("number", `${n / 7} w`);
  };
  const addWhen = (at: DateTime) => {
    add("date", at.toFormat("MM-dd"));
    add("time", at.toFormat("HH:mm"));
  };

  for (const day of DAY_KEYS) {
    for (const { open, close } of config.hours[day]) {
      add("time", open);
      add("time", close);
      const last = minutesOfDay(close) - config.seating.lastSeatingBeforeCloseMinutes;
      if (last >= 0) add("time", hhmm(Math.floor(last / 60), last % 60));
    }
  }
  for (const c of config.closures) add("date", c.date.slice(5));
  const { policies, seating, privateRoom } = config;
  addNumber(policies.bookingWindowDays, "d");
  addNumber(policies.freeChangeUntilHoursBefore, "h");
  for (const n of [
    policies.minLeadMinutes,
    policies.graceMinutes,
    seating.holdMinutes.default,
    seating.holdMinutes.partyOf5Plus,
    seating.slotIntervalMinutes,
    seating.lastSeatingBeforeCloseMinutes,
  ]) {
    addNumber(n, "min");
  }
  for (const n of [
    policies.maxPartyForAgent,
    privateRoom.min,
    privateRoom.max,
    ...seating.tables.map((t) => t.size),
  ]) {
    addNumber(n, "people");
  }
  for (const item of config.menu) add("price", String(item.price));
  for (const text of [...config.faq.map((f) => f.a), config.agent.greeting]) {
    for (const c of extractClaims(text)) add(c.kind, c.value);
  }

  add("date", DateTime.fromJSDate(now, { zone }).toFormat("MM-dd"));
  for (const slot of Object.values(session.offeredSlots)) {
    addWhen(DateTime.fromISO(slot.start, { zone }));
    addNumber(slot.partySize, "people");
  }
  for (const booking of Object.values(session.knownReservations)) {
    addWhen(DateTime.fromJSDate(new Date(booking.start), { zone }));
    addNumber(booking.partySize, "people");
  }
  return facts;
}

export function ungrounded(text: string, facts: Set<string>): Claim[] {
  return extractClaims(text).filter((c) => !facts.has(`${c.kind}:${c.value}`));
}

/** Remembers the values the caller stated, so echoing them back counts as grounded. */
export function recordCallerValues(session: SessionState, text: string): void {
  for (const c of extractClaims(text)) {
    const key = `${c.kind}:${c.value}`;
    if (!session.callerValues.includes(key)) session.callerValues.push(key);
  }
}

export function groundingNote(claims: Claim[]): string {
  const raws = [...new Set(claims.map((c) => c.raw))].join(", ");
  return `Your previous draft stated values not found in tool results or the business facts: ${raws}. Only state times, dates, prices and numbers from those sources; otherwise say "I don't have that, let me connect you."`;
}
