import { OAuth2Client } from "google-auth-library";
import { describe, expect, it } from "vitest";
import { authUrl, checkCallback, missingScopes, upsertEnvLine } from "./auth-flow.js";
import { GOOGLE_SCOPES } from "./env.js";

describe("upsertEnvLine", () => {
  it("replaces an existing key without touching others", () => {
    const before = "A=1\nGOOGLE_REFRESH_TOKEN=\nB=2\n";
    expect(upsertEnvLine(before, "GOOGLE_REFRESH_TOKEN", "1//new")).toBe(
      "A=1\nGOOGLE_REFRESH_TOKEN=1//new\nB=2\n",
    );
  });

  it("appends a missing key on its own line", () => {
    expect(upsertEnvLine("A=1", "GOOGLE_REFRESH_TOKEN", "1//new")).toBe(
      "A=1\nGOOGLE_REFRESH_TOKEN=1//new\n",
    );
    expect(upsertEnvLine("", "K", "v")).toBe("K=v\n");
  });

  it("does not match a key that only starts the same way", () => {
    expect(upsertEnvLine("GOOGLE_REFRESH_TOKEN_OLD=x\n", "GOOGLE_REFRESH_TOKEN", "y")).toBe(
      "GOOGLE_REFRESH_TOKEN_OLD=x\nGOOGLE_REFRESH_TOKEN=y\n",
    );
  });
});

describe("authUrl", () => {
  it("asks for offline access, fresh consent, PKCE and exactly our scopes", () => {
    const client = new OAuth2Client({
      clientId: "id.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:5555/oauth2callback",
    });
    const url = new URL(authUrl(client, { state: "st4te", codeChallenge: "ch4llenge" }));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("code_challenge")).toBe("ch4llenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...GOOGLE_SCOPES]);
  });
});

describe("checkCallback", () => {
  const cb = (q: string) => new URL(`http://127.0.0.1:5555/oauth2callback?${q}`);

  it("returns the code when the state matches", () => {
    expect(checkCallback(cb("code=abc&state=s1"), "s1")).toBe("abc");
  });

  it("rejects a state mismatch", () => {
    expect(() => checkCallback(cb("code=abc&state=evil"), "s1")).toThrow(/state/);
  });

  it("surfaces access_denied", () => {
    expect(() => checkCallback(cb("error=access_denied&state=s1"), "s1")).toThrow(/access_denied/);
  });

  it("rejects a callback without a code", () => {
    expect(() => checkCallback(cb("state=s1"), "s1")).toThrow(/code/);
  });
});

describe("missingScopes", () => {
  it("lists scopes the user unticked on the consent screen", () => {
    expect(missingScopes(GOOGLE_SCOPES.join(" "))).toEqual([]);
    expect(missingScopes("https://www.googleapis.com/auth/gmail.send")).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
    ]);
    expect(missingScopes(undefined)).toEqual([...GOOGLE_SCOPES]);
  });
});
