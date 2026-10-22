import { z } from "zod";

export const CONFIDENCE_THRESHOLD = 0.5;
export const OFF_TOPIC_LIMIT = 3;
export const TOOL_FAILURE_LIMIT = 2;
export const RATE_LIMIT_MAX_WAIT_MS = 3000;
export const HUMAN_OFFER = "If you'd like, I can connect you with someone from our team.";

const MetaSchema = z.object({
  confidence: z.number().min(0).max(1),
  onTopic: z.boolean(),
});

export interface Meta {
  confidence: number;
  onTopic: boolean;
  body: string;
  missing: boolean;
}

/** `@meta` (any case, optional colon) and its JSON object, or the rest of its line if malformed. */
const META = /@meta\s*:?[ \t]*(\{[^{}]*\}|[^\n]*)/gi;

/**
 * The model's structured self-report (plan ruling 9): the reply's first line is
 * `@meta {"confidence":0.82,"onTopic":true}`. The first `@meta` anywhere is honored and every
 * one is removed, so it is never spoken. A missing or invalid one is flagged and read as
 * confident and on topic (plan ruling 9).
 */
export function parseMeta(draft: string): Meta {
  const matches = [...draft.matchAll(META)];
  const body = draft
    .replace(META, "")
    .split("\n")
    .filter((line) => !/^\s*```\w*\s*$/.test(line))
    .join("\n")
    .trim();
  const json = matches[0]?.[1];
  if (!json?.startsWith("{")) return { confidence: 1, onTopic: true, body, missing: true };
  try {
    return { ...MetaSchema.parse(JSON.parse(json)), body, missing: false };
  } catch {
    return { confidence: 1, onTopic: true, body, missing: true };
  }
}
