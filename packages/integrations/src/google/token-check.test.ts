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
