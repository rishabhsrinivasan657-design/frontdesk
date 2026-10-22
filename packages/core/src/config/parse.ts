import { parse } from "yaml";
import { z } from "zod";
import { type BusinessConfig, BusinessConfigSchema } from "./schema.js";

export class BusinessConfigError extends Error {
  override name = "BusinessConfigError";
}

/** Parses and validates business config YAML. Throws BusinessConfigError with a readable message. */
export function parseBusinessConfig(yamlText: string): BusinessConfig {
  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch (error) {
    throw new BusinessConfigError(`Business config is not valid YAML: ${String(error)}`, {
      cause: error,
    });
  }
  const result = BusinessConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new BusinessConfigError(`Invalid business config:\n${z.prettifyError(result.error)}`, {
      cause: result.error,
    });
  }
  return result.data;
}
