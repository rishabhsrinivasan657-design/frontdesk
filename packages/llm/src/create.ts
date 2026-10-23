import type { LLMProvider } from "@frontdesk/core";
import { LLMConfigError, type ModelSpec, loadCatalog } from "./catalog.js";
import { type GeminiModels, GeminiProvider } from "./providers/gemini.js";
import { ReplayProvider } from "./providers/replay.js";
import type { RecordingStore } from "./recordings.js";
import type { CacheStore, RateLimitStore, SpendStore } from "./stores/types.js";
import { withCache } from "./wrappers/cache.js";
import { withHedge } from "./wrappers/hedge.js";
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
/** Free-tier model that races the primary (docs/learning/llm-latency.md); "none" turns it off. */
const DEFAULT_HEDGE_MODEL = "gemini-3.1-flash-lite";

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
 * SPEND_CAP_USD_MONTHLY, LLM_RECORD, LLM_TIMEOUT_MS (per Gemini call), LLM_HEDGE_MODEL,
 * LLM_HEDGE_AFTER_MS, GEMINI_API_KEY. Gemini is wrapped outermost first:
 * spend cap → [hedge across two models →] rate limiter → retry → cache → recorder. The hedge runs
 * on the free tier outside record mode only. Replay is never wrapped.
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
  const timeoutText = env.LLM_TIMEOUT_MS;
  const timeoutMs = timeoutText ? Number(timeoutText) : undefined;
  if (timeoutMs !== undefined && !(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
    throw new LLMConfigError(
      `LLM_TIMEOUT_MS must be a number of milliseconds > 0 (got ${JSON.stringify(timeoutText)})`,
    );
  }
  if (tier === "paid" && capUsd === 0) {
    throw new LLMConfigError(
      "LLM_TIER=paid refuses to start with SPEND_CAP_USD_MONTHLY=0; set a cap in USD",
    );
  }

  const hedge = hedgeModel(env, catalog, model);
  const afterMs = hedgeAfterMs(env);

  if (provider === "replay") return new ReplayProvider(deps.recordings, model);

  if (!deps.geminiClient && !env.GEMINI_API_KEY) {
    throw new LLMConfigError("GEMINI_API_KEY is not set; add it to the git-ignored .env");
  }
  const record = env.LLM_RECORD === "1";
  const stack = (id: string, limits: ModelSpec["freeTier"]): LLMProvider => {
    let llm: LLMProvider = new GeminiProvider({
      model: id,
      apiKey: env.GEMINI_API_KEY,
      client: deps.geminiClient,
      timeoutMs,
    });
    // Record mode skips the cache: a cached answer would never reach the recorder.
    if (record) llm = withRecorder(llm, { store: deps.recordings });
    else llm = withCache(llm, { store: deps.cache });
    llm = withRetry(llm, deps.retry);
    return withRateLimit(llm, { store: deps.rate, limits });
  };

  let llm = stack(model, spec.freeTier);
  // Paid tier: the loser's tokens would be billed but never counted. Record mode: replay
  // answers as one model, so a recording must come from one model.
  if (hedge && tier === "free" && !record) {
    llm = withHedge(llm, stack(hedge.id, hedge.spec.freeTier), { afterMs });
  }
  return withSpendCap(llm, { store: deps.spend, tier, capUsd, price: spec.pricePerMTok });
}

function hedgeModel(
  env: Record<string, string | undefined>,
  catalog: Map<string, ModelSpec>,
  primary: string,
): { id: string; spec: ModelSpec } | undefined {
  const id = env.LLM_HEDGE_MODEL || DEFAULT_HEDGE_MODEL;
  if (id === "none" || id === primary) return undefined;
  const spec = catalog.get(id);
  if (!spec) {
    throw new LLMConfigError(
      `LLM_HEDGE_MODEL must be "none" or one of: ${[...catalog.keys()].join(", ")} (got ${JSON.stringify(id)})`,
    );
  }
  return { id, spec };
}

function hedgeAfterMs(env: Record<string, string | undefined>): number {
  const text = env.LLM_HEDGE_AFTER_MS;
  if (!text) return 0;
  const ms = Number(text);
  if (!(Number.isFinite(ms) && ms >= 0)) {
    throw new LLMConfigError(
      `LLM_HEDGE_AFTER_MS must be a number of milliseconds >= 0 (got ${JSON.stringify(text)})`,
    );
  }
  return ms;
}
