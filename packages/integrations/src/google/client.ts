import { OAuth2Client } from "google-auth-library";
import type { GoogleEnv } from "./env.js";

/** An OAuth2 client that trades the stored refresh token for short-lived access tokens. */
export function createOAuthClient(
  env: Pick<GoogleEnv, "clientId" | "clientSecret" | "refreshToken">,
): OAuth2Client {
  const client = new OAuth2Client({ clientId: env.clientId, clientSecret: env.clientSecret });
  client.setCredentials({ refresh_token: env.refreshToken });
  return client;
}

/**
 * Per-call options for googleapis clients. googleapis retries failed GETs and DELETEs by
 * default, which would stretch the 10 s timeout to 30 s+ mid-conversation; a slow Google
 * should hand off fast instead (the email worker has its own retries).
 */
export const GOOGLE_API_OPTIONS = { timeout: 10_000, retry: false } as const;
