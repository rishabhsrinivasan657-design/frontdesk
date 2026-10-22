import { z } from "zod";

export const CONFIDENCE_THRESHOLD = 0.5;
export const OFF_TOPIC_LIMIT = 3;
export const TOOL_FAILURE_LIMIT = 2;
export const RATE_LIMIT_MAX_WAIT_MS = 3000;
export const HUMAN_OFFER = "If you'd like, I can connect you with someone from our team.";

const MetaSchema = z.strictObject({
  confidence: z.number().min(0).max(1),
  onTopic: z.boolean(),
});

export interface Meta {
  confidence: number;
  onTopic: boolean;
  body: string;
  missing: boolean;
}

/**
 * The model's structured self-report (plan ruling 9): the reply's first line is
 * `@meta {"confidence":0.82,"onTopic":true}`. A missing or invalid line is flagged and read as
 * confident and on topic; a malformed `@meta` line is still never spoken.
 */
export function parseMeta(draft: string): Meta {
  const trimmed = draft.trimStart();
  const newline = trimmed.indexOf("\n");
  const first = newline === -1 ? trimmed : trimmed.slice(0, newline);
  if (!first.startsWith("@meta")) {
    return { confidence: 1, onTopic: true, body: draft.trim(), missing: true };
  }
  const body = newline === -1 ? "" : trimmed.slice(newline + 1).trim();
  try {
    const meta = MetaSchema.parse(JSON.parse(first.slice("@meta".length)));
    return { ...meta, body, missing: false };
  } catch {
    return { confidence: 1, onTopic: true, body, missing: true };
  }
}
