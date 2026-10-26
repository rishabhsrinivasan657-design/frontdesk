import { describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { TurnstileBotCheck } from "./abuse/bot-check.js";
import { assertNotEvalDatabase, chatLimitsEnabled, readBotCheck, readOwnerEnv } from "./deps.js";

describe("assertNotEvalDatabase", () => {
  const base = "postgres://u:p@localhost:54320";
  it("refuses to start on the eval database", () => {
    expect(() => assertNotEvalDatabase(`${base}/frontdesk_eval`, `${base}/frontdesk_eval`)).toThrow(
      "DATABASE_URL points at the eval database",
    );
    expect(() => assertNotEvalDatabase(`${base}/other_eval?sslmode=disable`, undefined)).toThrow();
    expect(() => assertNotEvalDatabase(`${base}/frontdesk`, `${base}/frontdesk`)).toThrow();
  });

  it("accepts the main database", () => {
    expect(() =>
      assertNotEvalDatabase(`${base}/frontdesk`, `${base}/frontdesk_eval`),
    ).not.toThrow();
  });
});

describe("readOwnerEnv", () => {
  const redis = {} as Redis;
  const hash = "$2b$12$bX13T.PXi3cmoJZoO/EM1u2NHtVfbtDDxO//tL/sTA3fMNBfmRTdK";

  it("is off when neither value is set", () => {
    expect(readOwnerEnv({ OWNER_EMAIL: "", OWNER_PASSWORD_HASH: "" }, redis)).toBeUndefined();
  });

  it("needs both values and a bcrypt hash", () => {
    expect(() => readOwnerEnv({ OWNER_EMAIL: "o@x.test" }, redis)).toThrow("both");
    expect(() =>
      readOwnerEnv({ OWNER_EMAIL: "o@x.test", OWNER_PASSWORD_HASH: "hunter2" }, redis),
    ).toThrow("bcrypt");
  });

  it("reads the session TTL and secure flag", () => {
    const owner = readOwnerEnv(
      {
        OWNER_EMAIL: "o@x.test",
        OWNER_PASSWORD_HASH: hash,
        OWNER_SESSION_TTL_HOURS: "2",
        NODE_ENV: "production",
      },
      redis,
    );
    expect(owner).toMatchObject({ email: "o@x.test", sessionTtlMs: 7_200_000, secureCookie: true });
  });
});

describe("chatLimitsEnabled", () => {
  it("is on in production whatever CHAT_LIMITS says", () => {
    expect(chatLimitsEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(chatLimitsEnabled({ NODE_ENV: "production", CHAT_LIMITS: "off" })).toBe(true);
  });

  it("is off locally unless CHAT_LIMITS=on", () => {
    expect(chatLimitsEnabled({})).toBe(false);
    expect(chatLimitsEnabled({ CHAT_LIMITS: "on" })).toBe(true);
  });
});

describe("readBotCheck", () => {
  it("is off without a secret", () => {
    expect(readBotCheck({})).toBeUndefined();
  });

  it("needs the hostnames the widget serves", () => {
    expect(() => readBotCheck({ TURNSTILE_SECRET_KEY: "s" })).toThrow("TURNSTILE_HOSTNAMES");
  });

  it("builds a Turnstile check", () => {
    expect(
      readBotCheck({ TURNSTILE_SECRET_KEY: "s", TURNSTILE_HOSTNAMES: "a.duckdns.org, localhost" }),
    ).toBeInstanceOf(TurnstileBotCheck);
  });
});
