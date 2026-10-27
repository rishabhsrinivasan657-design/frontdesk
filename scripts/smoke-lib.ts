export interface SmokeDeps {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** Opens a WebSocket with the given Origin and resolves with its close code. */
  openWs(url: string, origin: string): Promise<number>;
}

export interface SmokeResult {
  name: string;
  ok: boolean;
}

/** Close codes the api uses (apps/api/src/server.ts). */
const BOT_CHECK_FAILED = 4403;
const ORIGIN_REFUSED = 1008;

/**
 * Checks a deployed Front Desk from outside (M10). It never opens a real chat, so it spends no
 * Gemini quota and books nothing. Every check is independent; one that throws just fails.
 */
export async function runSmoke(baseUrl: string, deps: SmokeDeps): Promise<SmokeResult[]> {
  const base = baseUrl.replace(/\/$/, "");
  const ws = `${base.replace(/^http/, "ws")}/ws`;
  const get = (path: string, init?: RequestInit) => deps.fetch(`${base}${path}`, init);

  const checks: [string, () => Promise<boolean>][] = [
    [
      "ready",
      async () => {
        const res = await get("/health/ready");
        return res.status === 200 && ((await res.json()) as { ok?: unknown }).ok === true;
      },
    ],
    [
      "talk shows the privacy notice",
      async () => {
        const res = await get("/talk");
        return res.status === 200 && (await res.text()).includes("stored for up to 30 days");
      },
    ],
    ["privacy page", async () => (await get("/privacy")).status === 200],
    ["chat needs the bot check", async () => (await deps.openWs(ws, base)) === BOT_CHECK_FAILED],
    [
      "chat refuses a foreign origin",
      async () => (await deps.openWs(ws, "https://evil.example")) === ORIGIN_REFUSED,
    ],
    ["owner api needs login", async () => (await get("/api/owner/me")).status === 401],
    [
      "dashboard redirects to login",
      async () => {
        const res = await get("/dashboard", { redirect: "manual" });
        return (
          res.status >= 300 && res.status < 400 && /\/login/.test(res.headers.get("location") ?? "")
        );
      },
    ],
    ["HSTS header", async () => (await get("/privacy")).headers.has("strict-transport-security")],
    [
      "http redirects to https",
      async () => {
        const res = await deps.fetch(`${base.replace(/^https:/, "http:")}/`, {
          redirect: "manual",
        });
        return (
          res.status >= 300 &&
          res.status < 400 &&
          (res.headers.get("location") ?? "").startsWith("https://")
        );
      },
    ],
  ];

  const results: SmokeResult[] = [];
  for (const [name, check] of checks) {
    results.push({ name, ok: await check().catch(() => false) });
  }
  return results;
}
