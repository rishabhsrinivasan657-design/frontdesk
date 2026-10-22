import {
  type AgentDeps,
  type Booking,
  type BusinessConfig,
  InMemoryAuditLog,
  InMemoryCalendar,
  InMemoryHandoffQueue,
  InMemoryMailer,
  InMemorySessionStore,
  InMemorySlotLock,
  type LLMProvider,
  ManualClock,
  holdMinutesFor,
  sequentialIds,
  tablesFromConfig,
} from "@frontdesk/core";
import { DateTime } from "luxon";
import type { Scenario } from "./scenario.js";

export const SESSION_ID = "eval";

export interface WorldDeps extends AgentDeps {
  calendar: InMemoryCalendar;
  audit: InMemoryAuditLog;
  handoffs: InMemoryHandoffQueue;
  clock: ManualClock;
}

/** The in-memory adapters one scenario runs against, plus what was seeded. */
export interface World {
  deps: WorldDeps;
  seeded: Booking[];
  sessionId: typeof SESSION_ID;
}

/** "YYYY-MM-DDTHH:mm" wall time in `tz` → instant. */
export function localToDate(local: string, tz: string): Date {
  const dt = DateTime.fromISO(local, { zone: tz });
  if (!dt.isValid) throw new Error(`Invalid local time ${JSON.stringify(local)}`);
  return dt.toJSDate();
}

/** Instant → "YYYY-MM-DDTHH:mm" wall time in `tz`. */
export function toLocal(date: Date, tz: string): string {
  return DateTime.fromJSDate(date, { zone: tz }).toFormat("yyyy-MM-dd'T'HH:mm");
}

/** Builds the agent's dependencies with the scenario's seed and a clock fixed at `seed.now`. */
export function seedWorld(scenario: Scenario, config: BusinessConfig, llm: LLMProvider): World {
  const tz = config.business.timezone;
  const tables = tablesFromConfig(config);
  const seeded: Booking[] = [];
  scenario.seed.reservations.forEach((r, i) => {
    const start = localToDate(r.start, tz);
    const end = new Date(start.getTime() + holdMinutesFor(config, r.party) * 60_000);
    const overlaps = (b: Booking) => b.start < end && start < b.end;
    const tableId =
      r.table ??
      tables.find(
        (t) => t.size >= r.party && !seeded.some((b) => b.tableId === t.id && overlaps(b)),
      )?.id;
    if (!tableId) {
      throw new Error(`Scenario ${scenario.id}: no table fits seed "${r.name}" (party ${r.party})`);
    }
    seeded.push({
      id: `seed_${i + 1}`,
      start,
      end,
      tableId,
      partySize: r.party,
      name: r.name,
      contact: r.contact ?? `${r.name.trim().split(/\s+/)[0]!.toLowerCase()}@example.com`,
      notes: r.notes ?? "",
    });
  });

  const clock = new ManualClock(new Date(scenario.seed.now));
  const ids = sequentialIds();
  return {
    deps: {
      config,
      calendar: new InMemoryCalendar(seeded, ids),
      clock,
      ids,
      llm,
      sessions: new InMemorySessionStore(),
      audit: new InMemoryAuditLog(),
      locks: new InMemorySlotLock(clock),
      mailer: new InMemoryMailer(),
      handoffs: new InMemoryHandoffQueue(),
    },
    seeded,
    sessionId: SESSION_ID,
  };
}
