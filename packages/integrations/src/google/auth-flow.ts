import { CodeChallengeMethod, type OAuth2Client } from "google-auth-library";
import { GOOGLE_SCOPES } from "./env.js";

/** Sets `key=value` in .env text: replaces the key's line, or appends one. Other lines are untouched. */
export function upsertEnvLine(contents: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const lines = contents === "" ? [] : contents.replace(/\n$/, "").split("\n");
  const at = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (at === -1) lines.push(line);
  else lines[at] = line;
  return `${lines.join("\n")}\n`;
}

/**
 * The consent URL: offline access (so Google issues a refresh token), a fresh consent
 * prompt (so it issues one even on a re-run), PKCE, and exactly Front Desk's scopes.
 */
export function authUrl(
  client: OAuth2Client,
  opts: { state: string; codeChallenge: string },
): string {
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...GOOGLE_SCOPES],
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
}

/** The authorization code from Google's redirect, after checking it answers our request. */
export function checkCallback(url: URL, expectedState: string): string {
  const error = url.searchParams.get("error");
  if (error)
    throw new Error(`Google returned "${error}". Run pnpm google:auth again and click Allow.`);
  if (url.searchParams.get("state") !== expectedState) {
    throw new Error("The callback's state does not match this sign-in; ignoring it.");
  }
  const code = url.searchParams.get("code");
  if (!code) throw new Error("The callback has no authorization code.");
  return code;
}

/** Scopes the user did not grant (Google lets them untick each one on the consent screen). */
export function missingScopes(granted: string | undefined): string[] {
  const have = new Set((granted ?? "").split(" "));
  return GOOGLE_SCOPES.filter((s) => !have.has(s));
}
