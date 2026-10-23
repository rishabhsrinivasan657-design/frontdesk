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
