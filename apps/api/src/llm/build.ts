import type { LLMProvider } from "@frontdesk/core";
import {
  MemoryRecordingStore,
  RedisCacheStore,
  RedisRateLimitStore,
  RedisSpendStore,
  createLLM,
} from "@frontdesk/llm";
import type { Redis } from "ioredis";
import { ScriptedLLM } from "./scripted.js";

/** `LLM_PROVIDER=scripted` is the keyless test receptionist; anything else goes to createLLM (spec §7). */
export function buildLLM(env: Record<string, string | undefined>, redis: Redis): LLMProvider {
  if (env.LLM_PROVIDER === "scripted") return new ScriptedLLM();
  return createLLM(env, {
    rate: new RedisRateLimitStore(redis),
    spend: new RedisSpendStore(redis),
    cache: new RedisCacheStore(redis),
    recordings: new MemoryRecordingStore(),
  });
}
