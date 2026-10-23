export const CORE_PACKAGE = "@frontdesk/core" as const;
export {
  BusinessConfigSchema,
  DAY_KEYS,
  HANDOFF_TRIGGERS,
  type BusinessConfig,
  type DayKey,
} from "./config/schema.js";
export { BusinessConfigError, parseBusinessConfig } from "./config/parse.js";
export { findSlots } from "./availability/find-slots.js";
export {
  UnknownTableError,
  holdMinutesFor,
  tablesFromConfig,
  type Table,
} from "./availability/tables.js";
export type { Reservation, Slot, SlotRequest } from "./availability/types.js";
export type {
  LLMChunk,
  LLMMessage,
  LLMProvider,
  LLMPurpose,
  LLMRequest,
  ToolCall,
  ToolEffect,
  ToolSpec,
  Usage,
} from "./llm/types.js";
export { LLMError, type LLMErrorCode, type LLMErrorOptions } from "./llm/errors.js";
export * from "./ports/index.js";
export * from "./adapters/memory/index.js";
export {
  HANDOFF_REASONS,
  newSession,
  type ActionArgs,
  type ActionKind,
  type AuditEvent,
  type AuditStage,
  type HandoffReason,
  type HandoffTicket,
  type PendingAction,
  type SessionState,
  type TranscriptEntry,
} from "./agent/types.js";
export {
  ClientMessageSchema,
  ServerMessageSchema,
  type ClientMessage,
  type ServerMessage,
  type SessionMessage,
} from "./protocol/messages.js";
export * from "./agent/index.js";
export * from "./gate/index.js";
