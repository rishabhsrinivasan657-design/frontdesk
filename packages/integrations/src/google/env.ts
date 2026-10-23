/** Exactly what Front Desk needs: create/move/cancel events, and send mail. Nothing else. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

export interface GoogleEnv {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** The dedicated "Casa Fiorella (demo)" calendar, never "primary". */
  calendarId: string;
  /** Where the live Gmail contract test sends (your own address). */
  gmailTestTo?: string;
}

type Env = Record<string, string | undefined>;

/**
 * Google credentials from the environment (the git-ignored .env), or undefined if any
 * is missing, so live tests can skip cleanly. Values are never logged.
 */
export function readGoogleEnv(env: Env = process.env): GoogleEnv | undefined {
  const get = (key: string) => env[key]?.trim() || undefined;
  const clientId = get("GOOGLE_CLIENT_ID");
  const clientSecret = get("GOOGLE_CLIENT_SECRET");
  const refreshToken = get("GOOGLE_REFRESH_TOKEN");
  const calendarId = get("GOOGLE_CALENDAR_ID");
  if (!clientId || !clientSecret || !refreshToken || !calendarId) return undefined;
  if (calendarId.toLowerCase() === "primary") {
    throw new Error(
      'GOOGLE_CALENDAR_ID must be the "Casa Fiorella (demo)" calendar\'s id, not your primary calendar (see docs/google-setup.md)',
    );
  }
  const gmailTestTo = get("GMAIL_TEST_TO");
  return {
    clientId,
    clientSecret,
    refreshToken,
    calendarId,
    ...(gmailTestTo ? { gmailTestTo } : {}),
  };
}
