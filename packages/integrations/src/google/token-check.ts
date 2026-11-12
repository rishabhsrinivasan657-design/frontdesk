import { googleFailure } from "./errors.js";

/** The part of an OAuth2 client the check needs. */
export interface TokenSource {
  getAccessToken(): Promise<{ token?: string | null }>;
}

/**
 * Whether the stored refresh token still works (M10 health). Takes a factory so every check
 * uses a new client: a cached access token would hide a revoked or expired refresh token for up
 * to an hour. Never throws and never returns the error, which could quote a token. `onFailure`
 * gets only the status and Google's reason code (`googleFailure`), so it is safe to log.
 */
export async function checkGoogleToken(
  newClient: () => TokenSource,
  onFailure: (reason: string) => void = () => {},
): Promise<boolean> {
  try {
    const { token } = await newClient().getAccessToken();
    if (typeof token === "string" && token.length > 0) return true;
    onFailure("Google token refresh returned no token");
    return false;
  } catch (error) {
    onFailure(googleFailure(error, "Google token refresh").message);
    return false;
  }
}
