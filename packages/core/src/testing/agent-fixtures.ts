import {
  InMemoryAuditLog,
  InMemoryCalendar,
  InMemoryHandoffQueue,
  InMemoryMailer,
  InMemorySessionStore,
  InMemorySlotLock,
  ManualClock,
  sequentialIds,
} from "../adapters/memory/index.js";
import { runReadTool } from "../agent/tools/read-tools.js";
import { newSession, type SessionState } from "../agent/types.js";
import type { BusinessConfig } from "../config/schema.js";
import type { Booking } from "../ports/calendar.js";
import { TestLLM } from "./test-llm.js";

export const FIXTURE_NOW = new Date("2026-11-04T14:00:00-05:00");

/** Ana Ruiz, Friday 2026-11-06 19:00 for 4 on t4-1. */
export const ANA: Booking = {
  id: "res_ana",
  start: new Date("2026-11-06T19:00:00-05:00"),
  end: new Date("2026-11-06T20:30:00-05:00"),
  tableId: "t4-1",
  partySize: 4,
  name: "Ana Ruiz",
  contact: "ana@example.com",
  notes: "",
};

/** Every in-memory dependency the agent needs, wired to one ManualClock. */
export function agentFixture(config: BusinessConfig, seed: Booking[] = [ANA], now = FIXTURE_NOW) {
  const clock = new ManualClock(now);
  const ids = sequentialIds();
  const calendar = new InMemoryCalendar(seed, ids);
  const deps = {
    config,
    calendar,
    clock,
    ids,
    llm: new TestLLM(),
    sessions: new InMemorySessionStore(),
    audit: new InMemoryAuditLog(),
    locks: new InMemorySlotLock(clock),
    mailer: new InMemoryMailer(),
    handoffs: new InMemoryHandoffQueue(),
  };
  const session: SessionState = newSession("s1", now);
  const readCtx = { config, calendar, clock, session };
  return {
    deps,
    session,
    /** Runs check_availability so the slot is offered (provenance) and returns its id. */
    async offer(date: string, time: string, partySize: number): Promise<string> {
      const result = await runReadTool("check_availability", { date, time, partySize }, readCtx);
      const slots = result.ok
        ? (result.data as { slots: { slotId: string; time: string }[] }).slots
        : [];
      const slot = slots.find((s) => s.time === time);
      if (!slot) throw new Error(`fixture: ${date} ${time} for ${partySize} is not available`);
      return slot.slotId;
    },
    /** Runs find_reservation so the booking is known (provenance). */
    async find(name: string, contact: string): Promise<void> {
      await runReadTool("find_reservation", { name, contact }, readCtx);
    },
  };
}
