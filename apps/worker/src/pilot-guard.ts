type Env = Record<string, string | undefined>;

const value = (env: Env, key: string) => env[key]?.trim() ?? "";

/** Each rule names the variable it checks; messages never include the value (it may be a secret). */
const RULES: { key: string; ok: (v: string) => boolean; why: string }[] = [
  { key: "LLM_PROVIDER", ok: (v) => v === "" || v === "gemini", why: "must be gemini" },
  { key: "LLM_TIER", ok: (v) => v === "" || v === "free", why: "must be free" },
  { key: "SPEND_CAP_USD_MONTHLY", ok: (v) => v === "" || v === "0", why: "must be 0" },
  { key: "LLM_RECORD", ok: (v) => v === "" || v === "0", why: "must be 0" },
  { key: "GEMINI_API_KEY_2", ok: (v) => v === "", why: "must not be set" },
  { key: "FRONTDESK_NOW", ok: (v) => v === "", why: "must not be set" },
  { key: "CONVERSATION_SOURCE", ok: (v) => v === "pilot", why: "must be pilot" },
  { key: "TURNSTILE_SECRET_KEY", ok: (v) => v !== "", why: "must be set" },
  { key: "OWNER_EMAIL", ok: (v) => v !== "", why: "must be set" },
  { key: "OWNER_PASSWORD_HASH", ok: (v) => v !== "", why: "must be set" },
  { key: "KEY_HASH_SECRET", ok: (v) => v.length >= 32, why: "must be at least 32 characters" },
  {
    // Whoever is trusted may claim any visitor address: single proxy addresses only, never a
    // range (a range can include the Docker gateway every published-port connection comes from).
    key: "TRUST_PROXY",
    ok: (v) =>
      v === "" ||
      v
        .split(",")
        .map((p) => p.trim())
        .every((p) => p !== "" && !p.includes("/") && p !== "0.0.0.0" && p !== "::"),
    why: "must list single proxy addresses, not ranges",
  },
  {
    key: "WEB_ORIGINS",
    ok: (v) => {
      const origins = v
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
      return origins.length > 0 && origins.every((o) => o.startsWith("https://"));
    },
    why: "must list https:// origins only",
  },
];

/**
 * The public pilot must cost $0 and keep its protections on (spec §7, §12). With
 * NODE_ENV=production the api and worker refuse to start on any unsafe setting.
 */
export function assertPilotSafe(env: Env): void {
  if (env.NODE_ENV !== "production") return;
  for (const rule of RULES) {
    if (!rule.ok(value(env, rule.key))) {
      throw new Error(`Refusing to start in production: ${rule.key} ${rule.why}`);
    }
  }
}

/** Where the api records conversations (spec §10). `eval` lives only in the eval database. */
export function readConversationSource(env: Env): "live" | "pilot" {
  const source = value(env, "CONVERSATION_SOURCE") || "live";
  if (source !== "live" && source !== "pilot") {
    throw new Error("CONVERSATION_SOURCE must be live or pilot");
  }
  return source;
}
