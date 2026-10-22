import { readFileSync } from "node:fs";
import { type BusinessConfig, parseBusinessConfig } from "@frontdesk/core";
import { BUSINESS_FILE } from "./paths.js";

export function loadConfig(path: string = BUSINESS_FILE): BusinessConfig {
  return parseBusinessConfig(readFileSync(path, "utf8"));
}
