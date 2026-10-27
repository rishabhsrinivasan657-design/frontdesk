/** The part of an OAuth2 client the check needs. */
export interface TokenSource {
  getAccessToken(): Promise<{ token?: string | null }>;
}

/**
 * Whether the stored refresh token still works (M10 health). Takes a factory so every check
 * uses a new client: a cached access token would hide a revoked or expired refresh token for up
 * to an hour. Never throws and never returns the error, which could quote a token.
 */
export async function checkGoogleToken(newClient: () => TokenSource): Promise<boolean> {
  try {
    const { token } = await newClient().getAccessToken();
    return typeof token === "string" && token.length > 0;
  } catch {
    return false;
  }
}
