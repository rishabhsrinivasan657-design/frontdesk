import { describe, expect, it } from "vitest";
import { createOAuthClient } from "./client.js";
import { GOOGLE_SCOPES, readGoogleEnv } from "./env.js";

const full = {
  GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REFRESH_TOKEN: "refresh-token",
  GOOGLE_CALENDAR_ID: "abc123@group.calendar.google.com",
};

describe("readGoogleEnv", () => {
  it("reads every credential", () => {
    expect(readGoogleEnv({ ...full, GMAIL_TEST_TO: "me@example.com" })).toEqual({
      clientId: full.GOOGLE_CLIENT_ID,
      clientSecret: full.GOOGLE_CLIENT_SECRET,
      refreshToken: full.GOOGLE_REFRESH_TOKEN,
      calendarId: full.GOOGLE_CALENDAR_ID,
      gmailTestTo: "me@example.com",
    });
  });

  it.each(Object.keys(full))("returns undefined when %s is missing or blank", (key) => {
    expect(readGoogleEnv({ ...full, [key]: undefined })).toBeUndefined();
    expect(readGoogleEnv({ ...full, [key]: "  " })).toBeUndefined();
  });

  it("refuses the primary calendar", () => {
    expect(() => readGoogleEnv({ ...full, GOOGLE_CALENDAR_ID: "primary" })).toThrow(
      /Casa Fiorella \(demo\)/,
    );
  });

  it("asks for exactly Calendar events and Gmail send", () => {
    expect(GOOGLE_SCOPES).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/gmail.send",
    ]);
  });
});

describe("createOAuthClient", () => {
  it("carries the refresh token as its credential", () => {
    const env = readGoogleEnv(full)!;
    expect(createOAuthClient(env).credentials).toEqual({ refresh_token: "refresh-token" });
  });
});
