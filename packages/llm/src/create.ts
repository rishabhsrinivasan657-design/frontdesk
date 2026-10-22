import type { LLMProvider } from "@frontdesk/core";
import { LLMConfigError, type ModelSpec, loadCatalog } from "./catalog.js";
import { type GeminiModels, GeminiProvider } from "./providers/gemini.js";
import { ReplayProvider } from "./providers/replay.js";
import type { RecordingStore } from "./recordings.js";
import type { CacheStore, RateLimitStore, SpendStore } from "./stores/types.js";
import { withCache } from "./wrappers/cache.js";
import { withRateLimit } from "./wrappers/rate-limit.js";
import { withRecorder } from "./wrappers/recorder.js";
import { type RetryOptions, withRetry } from "./wrappers/retry.js";
import { withSpendCap } from "./wrappers/spend-cap.js";

export interface CreateLLMDeps {
  rate: RateLimitStore;
  spend: SpendStore;
  cache: CacheStore;
  recordings: RecordingStore;
  catalog?: Map<string, ModelSpec>;
  /** Injected SDK client (tests); otherwise GEMINI_API_KEY is required. */
  geminiClient?: GeminiModels;
  retry?: RetryOptions;
}

const PROVIDERS = ["gemini", "replay"] as const;
const TIERS = ["free", "paid"] as const;
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new LLMConfigError(
      `${name} must be one of: ${allowed.join(", ")} (got ${JSON.stringify(value)})`,
    );
  }
  return value as T;
}

/**
 * Builds the LLM stack from env (spec §7): LLM_PROVIDER, LLM_MODEL, LLM_TIER,
 * SPEND_CAP_USD_MONTHLY, LLM_RECORD, GEMINI_API_KEY. Gemini is wrapped outermost first:
 * spend cap → rate limiter → retry → cache → recorder. Replay is never wrapped.
 * Throws LLMConfigError so the process refuses to start on a bad config.
 */
export function createLLM(
  env: Record<string, string | undefined>,
  deps: CreateLLMDeps,
): LLMProvider {
  const catalog = deps.catalog ?? loadCatalog();
  const provider = oneOf("LLM_PROVIDER", env.LLM_PROVIDER || "gemini", PROVIDERS);
  const tier = oneOf("LLM_TIER", env.LLM_TIER || "free", TIERS);
  const model = env.LLM_MODEL || DEFAULT_MODEL;
  const spec = catalog.get(model);
  if (!spec) {
    throw new LLMConfigError(
      `LLM_MODEL must be one of: ${[...catalog.keys()].join(", ")} (got ${JSON.stringify(model)})`,
    );
  }

  const capText = env.SPEND_CAP_USD_MONTHLY || "0";
  const capUsd = Number(capText);
  if (!Number.isFinite(capUsd) || capUsd < 0) {
    throw new LLMConfigError(
      `SPEND_CAP_USD_MONTHLY must be a number ≥ 0 (got ${JSON.stringify(capText)})`,
    );
  }
  if (tier === "paid" && capUsd === 0) {
    throw new LLMConfigError(
      "LLM_TIER=paid refuses to start with SPEND_CAP_USD_MONTHLY=0; set a cap in USD",
    );
  }

  if (provider === "replay") return new ReplayProvider(deps.recordings, model);

  if (!deps.geminiClient && !env.GEMINI_API_KEY) {
    throw new LLMConfigError("GEMINI_API_KEY is not set; add it to the git-ignored .env");
  }
  let llm: LLMProvider = new GeminiProvider({
    model,
    apiKey: env.GEMINI_API_KEY,
    client: deps.geminiClient,
  });
  if (env.LLM_RECORD === "1") llm = withRecorder(llm, { store: deps.recordings });
  llm = withCache(llm, { store: deps.cache });
  llm = withRetry(llm, deps.retry);
  llm = withRateLimit(llm, { store: deps.rate, limits: spec.freeTier });
  return withSpendCap(llm, { store: deps.spend, tier, capUsd, price: spec.pricePerMTok });
}
