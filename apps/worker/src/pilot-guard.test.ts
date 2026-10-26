import { describe, expect, it } from "vitest";
import { assertPilotSafe, readConversationSource } from "./pilot-guard.js";

const SECRET = "sekret-123";

/** A production env that passes every rule. */
const good = (): Record<string, string | undefined> => ({
  NODE_ENV: "production",
  LLM_PROVIDER: "gemini",
  LLM_TIER: "free",
  SPEND_CAP_USD_MONTHLY: "0",
  LLM_RECORD: "0",
  CONVERSATION_SOURCE: "pilot",
  TURNSTILE_SECRET_KEY: "turnstile-secret",
  OWNER_EMAIL: "owner@example.com",
  OWNER_PASSWORD_HASH: "$2b$12$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234",
  WEB_ORIGINS: "https://casa.duckdns.org",
  KEY_HASH_SECRET: "a-long-random-secret-of-32-chars",
});

describe("assertPilotSafe", () => {
  it("allows a valid production env", () => {
    expect(() => assertPilotSafe(good())).not.toThrow();
  });

  it("is a no-op outside production", () => {
    expect(() => assertPilotSafe({ LLM_TIER: "paid", SPEND_CAP_USD_MONTHLY: "50" })).not.toThrow();
  });

  it.each([
    ["LLM_TIER", SECRET],
    ["SPEND_CAP_USD_MONTHLY", SECRET],
    ["LLM_PROVIDER", SECRET],
    ["LLM_RECORD", SECRET],
    ["GEMINI_API_KEY_2", SECRET],
    ["FRONTDESK_NOW", SECRET],
    ["CONVERSATION_SOURCE", SECRET],
    ["TURNSTILE_SECRET_KEY", ""],
    ["OWNER_EMAIL", ""],
    ["OWNER_PASSWORD_HASH", ""],
    ["WEB_ORIGINS", `http://${SECRET}`],
    ["KEY_HASH_SECRET", ""],
    ["KEY_HASH_SECRET", "short"],
  ])("refuses %s, naming it but never its value", (key, value) => {
    const env = { ...good(), [key]: value };
    expect(() => assertPilotSafe(env)).toThrow(key);
    try {
      assertPilotSafe(env);
    } catch (error) {
      expect((error as Error).message).not.toContain(SECRET);
    }
  });

  it("refuses an empty WEB_ORIGINS", () => {
    expect(() => assertPilotSafe({ ...good(), WEB_ORIGINS: "" })).toThrow("WEB_ORIGINS");
  });

  it("treats an unset LLM_PROVIDER, LLM_TIER, cap and record flag as their safe defaults", () => {
    const env = good();
    delete env.LLM_PROVIDER;
    delete env.LLM_TIER;
    delete env.SPEND_CAP_USD_MONTHLY;
    delete env.LLM_RECORD;
    expect(() => assertPilotSafe(env)).not.toThrow();
  });
});

describe("readConversationSource", () => {
  it("defaults to live", () => {
    expect(readConversationSource({})).toBe("live");
  });

  it("reads pilot", () => {
    expect(readConversationSource({ CONVERSATION_SOURCE: "pilot" })).toBe("pilot");
  });

  it("refuses eval and anything else", () => {
    expect(() => readConversationSource({ CONVERSATION_SOURCE: "eval" })).toThrow(
      "CONVERSATION_SOURCE",
    );
  });
});
