import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { HANDOFF_REASONS } from "@frontdesk/core";
import { parse } from "yaml";
import { z } from "zod";

export const CATEGORIES = [
  "booking",
  "reschedule",
  "cancel",
  "vague",
  "angry",
  "off_topic",
  "double_booking",
  "injection",
  "handoff",
  "faq",
  "policy_edge",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const OUTCOMES = [
  "booked",
  "rescheduled",
  "cancelled",
  "handoff",
  "info_only",
  "refused",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Business-local wall time, e.g. 2026-11-06T19:00 (read in the config's time zone). */
const LocalTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "expected YYYY-MM-DDTHH:mm");
const Party = z.number().int().min(1);

const SeedReservationSchema = z.strictObject({
  name: z.string().min(1),
  start: LocalTime,
  party: Party,
  contact: z.string().min(1).optional(),
  table: z.string().min(1).optional(),
  notes: z.string().optional(),
});
export type SeedReservation = z.infer<typeof SeedReservationSchema>;

const ExpectedBookingSchema = z.strictObject({
  name: z.string().min(1),
  start: LocalTime,
  party: Party,
});
export type ExpectedBooking = z.infer<typeof ExpectedBookingSchema>;

/** One eval scenario (spec §9). The caller simulator sees only `persona` and `goal`. */
export const ScenarioSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  category: z.enum(CATEGORIES),
  persona: z.string().min(1),
  goal: z.string().min(1),
  seed: z.strictObject({
    now: z.iso.datetime({ offset: true }),
    reservations: z.array(SeedReservationSchema).default([]),
    /** Minutes the clock jumps after the agent's first read-back (to let a pending action expire). */
    readbackPauseMinutes: z.number().int().min(1).max(60).optional(),
  }),
  expect: z.strictObject({
    outcome: z.enum(OUTCOMES),
    /** The whole final calendar; omitted means "unchanged from the seed". */
    calendar: z.array(ExpectedBookingSchema).optional(),
    handoffReason: z.enum(HANDOFF_REASONS).nullable().default(null),
    maxTurns: z.number().int().min(1).max(20).default(8),
  }),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

/** Every `*.yaml`/`*.yml` in `dir`, validated, sorted by id. Errors name the file. */
export async function loadScenarios(dir: string): Promise<Scenario[]> {
  const files = (await readdir(dir)).filter((f) => [".yaml", ".yml"].includes(extname(f)));
  const scenarios: Scenario[] = [];
  const seen = new Map<string, string>();
  for (const file of files.sort()) {
    const result = ScenarioSchema.safeParse(parse(await readFile(join(dir, file), "utf8")));
    if (!result.success) throw new Error(`${file}: ${z.prettifyError(result.error)}`);
    const scenario = result.data;
    if (scenario.id !== basename(file, extname(file))) {
      throw new Error(`${file}: id "${scenario.id}" must match the file name`);
    }
    const earlier = seen.get(scenario.id);
    if (earlier)
      throw new Error(`Duplicate scenario id "${scenario.id}" in ${earlier} and ${file}`);
    seen.set(scenario.id, file);
    scenarios.push(scenario);
  }
  return scenarios.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
