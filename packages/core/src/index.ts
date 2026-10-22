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
