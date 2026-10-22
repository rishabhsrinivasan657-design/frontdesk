import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

export class LLMConfigError extends Error {
  override name = "LLMConfigError";
}

const nonNegative = z.number().nonnegative();

const ModelEntrySchema = z.strictObject({
  provider: z.literal("gemini"),
  freeTier: z
    .strictObject({ rpm: z.number().int().positive(), rpd: z.number().int().positive() })
    .optional(),
  pricePerMTok: z.strictObject({ input: nonNegative, output: nonNegative }),
  source: z.string().min(1),
});

const CatalogSchema = z.strictObject({ models: z.record(z.string(), ModelEntrySchema) });

export type ModelSpec = z.infer<typeof ModelEntrySchema> & { id: string };

const DEFAULT_CATALOG = new URL("../models.yaml", import.meta.url);

/** Loads the model catalog (defaults to packages/llm/models.yaml). Throws LLMConfigError. */
export function loadCatalog(
  yamlText = readFileSync(DEFAULT_CATALOG, "utf8"),
): Map<string, ModelSpec> {
  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch (error) {
    throw new LLMConfigError(`Model catalog is not valid YAML: ${String(error)}`, { cause: error });
  }
  const result = CatalogSchema.safeParse(raw);
  if (!result.success) {
    throw new LLMConfigError(`Invalid model catalog:\n${z.prettifyError(result.error)}`, {
      cause: result.error,
    });
  }
  return new Map(Object.entries(result.data.models).map(([id, spec]) => [id, { ...spec, id }]));
}
