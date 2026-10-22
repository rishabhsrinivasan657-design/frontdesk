import { readFileSync } from "node:fs";
import { type BusinessConfig, BusinessConfigError, parseBusinessConfig } from "@frontdesk/core";

/** Reads and validates a business config file. The api calls this at startup and refuses to start on error. */
export function loadBusinessConfig(path: string): BusinessConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new BusinessConfigError(`Cannot read business config at ${path}: ${String(error)}`, {
      cause: error,
    });
  }
  return parseBusinessConfig(text);
}
