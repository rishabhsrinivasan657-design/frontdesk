import { resolve } from "node:path";
import {
  type AgentDeps,
  InMemoryAuditLog,
  InMemoryCalendar,
  InMemoryHandoffQueue,
  InMemoryMailer,
  InMemorySessionStore,
  InMemorySlotLock,
  type LLMProvider,
  ManualClock,
  sequentialIds,
} from "@frontdesk/core";
import { loadBusinessConfig } from "./business-config.js";
import { ScriptedLLM } from "./llm/scripted.js";

/** Wednesday 2026-11-04 14:00 New York: Saturday 2026-11-07 19:00 is open. */
export const TEST_NOW = new Date("2026-11-04T14:00:00-05:00");
export const CONFIG_PATH = resolve(import.meta.dirname, "../../../businesses/casa-fiorella.yaml");

/** Every in-memory dependency the agent needs, with the real business config. Tests only. */
export function memoryDeps(llm: LLMProvider = new ScriptedLLM()) {
  const clock = new ManualClock(TEST_NOW);
  const ids = sequentialIds();
  return {
    config: loadBusinessConfig(CONFIG_PATH),
    calendar: new InMemoryCalendar([], ids),
    clock,
    ids,
    llm,
    sessions: new InMemorySessionStore(),
    audit: new InMemoryAuditLog(),
    locks: new InMemorySlotLock(clock),
    mailer: new InMemoryMailer(),
    handoffs: new InMemoryHandoffQueue(),
  } satisfies AgentDeps;
}

export const BOOK = "A table for 4 on 2026-11-07 at 19:00";
export const DETAILS = "Bo Chen, bo@example.com";
