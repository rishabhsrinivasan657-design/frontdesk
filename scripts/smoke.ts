import WebSocket from "ws";
import { runSmoke } from "./smoke-lib.js";

/**
 * `pnpm smoke https://<your-site>` (M10): checks a deployed Front Desk from outside without
 * opening a real chat. Prints check names only. Exits 1 if any check fails.
 */
const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base)) {
  console.error("usage: pnpm smoke https://<your-site>");
  process.exit(2);
}

function openWs(url: string, origin: string): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers: { origin } });
    const timer = setTimeout(() => {
      ws.terminate();
      resolve(0);
    }, 10_000);
    ws.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    ws.on("unexpected-response", () => {
      clearTimeout(timer);
      resolve(0);
    });
    ws.on("error", () => undefined);
  });
}

const results = await runSmoke(base, {
  fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }),
  openWs,
});
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? "smoke: all passed" : `smoke: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
