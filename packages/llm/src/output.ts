import { LLMError } from "@frontdesk/core";
import { type ZodType, z } from "zod";

/** Validates structured model output; a mismatch is invalid_output (never retried). */
export function parseOutput<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new LLMError(
      "invalid_output",
      `Model output failed the schema:\n${z.prettifyError(result.error)}`,
      { cause: result.error },
    );
  }
  return result.data;
}
