import { defineConfig, devices } from "@playwright/test";
import { E2E_DATABASE_URL, E2E_NOW } from "./e2e-db";
import { OWNER } from "./helpers";

/**
 * Keyless, deterministic e2e (spec §13): the api runs the scripted LLM on an in-memory calendar
 * with its clock fixed at Wed 2026-11-04 14:00 New York, on its own ports and queue prefix.
 * Needs Docker Postgres + Redis (`pnpm infra:up`, `pnpm db:migrate`).
 */
const API_PORT = 4100;
const TURNSTILE_TEST = {
  siteKey: "1x00000000000000000000AA",
  secret: "1x0000000000000000000000000000000AA",
} as const;
const WEB_PORT = 3100;
const ci = !!process.env.CI;

export default defineConfig({
  testDir: ".",
  // Its own database (frontdesk_e2e), migrated and re-seeded with demo data every run.
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: ci ? 1 : 0,
  // Paths here resolve from this folder; reports go to the repo root (git-ignored).
  outputDir: "../test-results",
  reporter: ci
    ? [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]]
    : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm api",
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        API_PORT: String(API_PORT),
        WEB_ORIGINS: `http://localhost:${WEB_PORT}`,
        LLM_PROVIDER: "scripted",
        FRONTDESK_NOW: E2E_NOW,
        DATABASE_URL: E2E_DATABASE_URL,
        QUEUE_PREFIX: "e2e",
        // Blank, so the in-memory calendar is used even where .env has Google credentials.
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
        GOOGLE_REFRESH_TOKEN: "",
        GOOGLE_CALENDAR_ID: "",
        OWNER_EMAIL: OWNER.email,
        OWNER_PASSWORD_HASH: OWNER.hash,
        // Cloudflare's published always-pass Turnstile test keys: the real bot-check flow, no account.
        TURNSTILE_SECRET_KEY: TURNSTILE_TEST.secret,
        TURNSTILE_HOSTNAMES: "localhost,example.com",
      },
    },
    {
      command: `pnpm --filter @frontdesk/web build && pnpm --filter @frontdesk/web exec next start -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/talk`,
      reuseExistingServer: false,
      timeout: 180_000,
      // The voice test hook is compiled in only for this build (voice/providers.ts).
      env: {
        NEXT_PUBLIC_API_WS_URL: `ws://localhost:${API_PORT}/ws`,
        NEXT_PUBLIC_VOICE_TEST_HOOK: "1",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_TEST.siteKey,
        // The dashboard's server side talks to the api directly.
        API_URL: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
