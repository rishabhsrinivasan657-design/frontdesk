import { describe, expect, it } from "vitest";
import { checkGoogleToken } from "./token-check.js";

describe("checkGoogleToken", () => {
  it("true when a fresh access token comes back", async () => {
    expect(
      await checkGoogleToken(() => ({ getAccessToken: () => Promise.resolve({ token: "a" }) })),
    ).toBe(true);
  });

  it("false on invalid_grant (an expired or revoked refresh token), never throwing", async () => {
    const expired = () => ({
      getAccessToken: () => Promise.reject(new Error("invalid_grant: Token has been expired")),
    });
    expect(await checkGoogleToken(expired)).toBe(false);
  });

  it("reports Google's reason code on failure, never the error's text or request", async () => {
    const rejected = Object.assign(new Error("invalid_grant: secret-refresh-token-value"), {
      response: { status: 400, data: { error: "invalid_grant" } },
      config: { data: "refresh_token=secret-refresh-token-value" },
    });
    const reasons: string[] = [];
    const ok = await checkGoogleToken(
      () => ({ getAccessToken: () => Promise.reject(rejected) }),
      (reason) => reasons.push(reason),
    );
    expect(ok).toBe(false);
    expect(reasons).toEqual(["Google token refresh failed: 400 invalid_grant"]);
  });

  it("reports an empty token as its own reason", async () => {
    const reasons: string[] = [];
    await checkGoogleToken(
      () => ({ getAccessToken: () => Promise.resolve({ token: null }) }),
      (reason) => reasons.push(reason),
    );
    expect(reasons).toEqual(["Google token refresh returned no token"]);
  });

  it("false when no token comes back", async () => {
    expect(
      await checkGoogleToken(() => ({ getAccessToken: () => Promise.resolve({ token: null }) })),
    ).toBe(false);
  });

  it("uses a new client each time, so a cached access token can't hide a dead refresh token", async () => {
    let made = 0;
    const factory = () => (made++, { getAccessToken: () => Promise.resolve({ token: "a" }) });
    await checkGoogleToken(factory);
    await checkGoogleToken(factory);
    expect(made).toBe(2);
  });
});
