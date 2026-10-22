export const CORE_PACKAGE = "@frontdesk/core" as const;
export {
  BusinessConfigSchema,
  DAY_KEYS,
  HANDOFF_TRIGGERS,
  type BusinessConfig,
  type DayKey,
} from "./config/schema.js";
export { BusinessConfigError, parseBusinessConfig } from "./config/parse.js";
