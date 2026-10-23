/**
 * `pnpm google:auth`: signs you in to Google on this machine and saves a refresh token
 * to the git-ignored .env. The token and client secret are never printed.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { OAuth2Client } from "google-auth-library";
import { authUrl, checkCallback, missingScopes, upsertEnvLine } from "./auth-flow.js";

const ENV_PATH = resolve(import.meta.dirname, "../../../../.env");
const TIMEOUT_MS = 5 * 60_000;

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!existsSync(ENV_PATH))
  fail("No .env file. Copy .env.example to .env first (docs/google-setup.md, step 7).");
const env = parse(readFileSync(ENV_PATH));
const clientId = env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
if (!clientId || !clientSecret) {
  fail(
    "Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first (docs/google-setup.md, step 7).",
  );
}

const state = randomBytes(16).toString("hex");
const server = createServer();
server.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/oauth2callback`;
const client = new OAuth2Client({ clientId, clientSecret, redirectUri });
const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
const url = authUrl(client, { state, codeChallenge: codeChallenge! });

const timer = setTimeout(
  () => fail("Timed out after 5 minutes. Run pnpm google:auth again."),
  TIMEOUT_MS,
);

server.on("request", (req, res) => {
  const callback = new URL(req.url ?? "/", redirectUri);
  if (callback.pathname !== "/oauth2callback") {
    res.writeHead(404).end();
    return;
  }
  void (async () => {
    try {
      const code = checkCallback(callback, state);
      const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri });
      if (!tokens.refresh_token) {
        throw new Error(
          "Google sent no refresh token. Remove Front Desk's access at https://myaccount.google.com/permissions and run pnpm google:auth again.",
        );
      }
      const missing = missingScopes(tokens.scope ?? undefined);
      if (missing.length) {
        throw new Error(
          `Some permissions were not granted: ${missing.join(", ")}. Run again and tick every box.`,
        );
      }
      writeFileSync(
        ENV_PATH,
        upsertEnvLine(readFileSync(ENV_PATH, "utf8"), "GOOGLE_REFRESH_TOKEN", tokens.refresh_token),
        {
          mode: 0o600,
        },
      );
      res
        .writeHead(200, { "content-type": "text/plain" })
        .end("Front Desk is connected. You can close this tab.");
      console.log("\nSaved a refresh token to .env. Next: pnpm test:google\n");
      clearTimeout(timer);
      server.close();
    } catch (error) {
      res.writeHead(400, { "content-type": "text/plain" }).end("Sign-in failed. See the terminal.");
      // Our own messages only: token-exchange errors are reduced to their OAuth error code.
      const oauthCode = (error as { response?: { data?: { error?: unknown } } }).response?.data
        ?.error;
      fail(
        typeof oauthCode === "string"
          ? `Google refused the sign-in: ${oauthCode}`
          : (error as Error).message,
      );
    }
  })();
});

console.log("\nOpening Google sign-in in your browser. If it doesn't open, visit:\n");
console.log(`${url}\n`);
const opener =
  process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
spawn(opener, [url], { stdio: "ignore", detached: true })
  .on("error", () => undefined)
  .unref();
