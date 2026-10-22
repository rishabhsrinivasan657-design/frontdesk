import { DateTime, IANAZone } from "luxon";
import { z } from "zod";

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const HANDOFF_TRIGGERS = [
  "private_event",
  "party_too_large",
  "allergy_safety",
  "complaint",
  "human_requested",
  "late_change",
] as const;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "HH:mm" → minutes since midnight. Assumes the value already matched TIME. */
export function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h! * 60 + m!;
}

const positiveInt = z.number().int().positive();
const time = z.string().regex(TIME, 'must be "HH:mm" (00:00–23:59)');
const isoDate = z
  .string()
  .regex(DATE, 'must be "YYYY-MM-DD"')
  .refine((d) => DateTime.fromISO(d).isValid, "is not a real calendar date");

const interval = z.strictObject({ open: time, close: time });
const dayHours = z.array(interval).superRefine((intervals, ctx) => {
  const sorted = intervals
    .map((i) => [minutesOfDay(i.open), minutesOfDay(i.close)] as const)
    .sort((a, b) => a[0] - b[0]);
  for (const [open, close] of sorted) {
    if (close <= open) ctx.addIssue({ code: "custom", message: "close must be after open" });
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]![0] < sorted[i - 1]![1]) {
      ctx.addIssue({ code: "custom", message: "opening intervals overlap" });
    }
  }
});

const hours = z.strictObject(
  Object.fromEntries(DAY_KEYS.map((day) => [day, dayHours])) as Record<DayKey, typeof dayHours>,
);

const seating = z.strictObject({
  tables: z
    .array(z.strictObject({ size: positiveInt, count: positiveInt }))
    .min(1)
    .refine(
      (tables) => new Set(tables.map((t) => t.size)).size === tables.length,
      "each table size may appear only once",
    ),
  holdMinutes: z.strictObject({ default: positiveInt, partyOf5Plus: positiveInt }),
  slotIntervalMinutes: positiveInt.refine((n) => 1440 % n === 0, "must divide a day evenly"),
  lastSeatingBeforeCloseMinutes: z.number().int().nonnegative(),
});

export const BusinessConfigSchema = z
  .strictObject({
    business: z.strictObject({
      name: z.string().min(1),
      phone: z.string().min(1),
      email: z.email(),
      address: z.string().min(1),
      timezone: z.string().refine((tz) => IANAZone.isValidZone(tz), "is not an IANA timezone"),
    }),
    hours,
    closures: z.array(z.strictObject({ date: isoDate, reason: z.string().min(1) })),
    seating,
    policies: z.strictObject({
      bookingWindowDays: positiveInt,
      minLeadMinutes: z.number().int().nonnegative(),
      maxPartyForAgent: positiveInt,
      freeChangeUntilHoursBefore: z.number().nonnegative(),
      graceMinutes: z.number().int().nonnegative(),
    }),
    privateRoom: z
      .strictObject({
        name: z.string().min(1),
        min: positiveInt,
        max: positiveInt,
        agentMayBook: z.boolean(),
      })
      .refine((room) => room.min <= room.max, "min must not exceed max"),
    menu: z.array(
      z.strictObject({
        item: z.string().min(1),
        price: z.number().nonnegative(),
        tags: z.array(z.string()),
      }),
    ),
    faq: z.array(
      z.strictObject({
        id: z.string().min(1),
        q: z.string().min(1),
        a: z.string().min(1),
        keywords: z.array(z.string()),
      }),
    ),
    handoffTriggers: z.array(z.enum(HANDOFF_TRIGGERS)),
    agent: z.strictObject({
      persona: z.string().min(1),
      greeting: z.string().min(1),
      voice: z.strictObject({ lang: z.string().min(1), rate: z.number().positive() }),
    }),
  })
  .superRefine((config, ctx) => {
    const grid = config.seating.slotIntervalMinutes;
    for (const day of DAY_KEYS) {
      config.hours[day].forEach((i, index) => {
        for (const edge of ["open", "close"] as const) {
          if (minutesOfDay(i[edge]) % grid !== 0) {
            ctx.addIssue({
              code: "custom",
              path: ["hours", day, index, edge],
              message: `must fall on the ${grid}-minute slot grid`,
            });
          }
        }
      });
    }
  });

export type BusinessConfig = z.infer<typeof BusinessConfigSchema>;
