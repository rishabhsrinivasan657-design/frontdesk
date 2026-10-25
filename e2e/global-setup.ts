import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/** Demo data for the dashboard specs, dated by the api's fixed clock. Idempotent. */
export default function globalSetup(): void {
  execFileSync("pnpm", ["db:seed"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: { ...process.env, FRONTDESK_NOW: "2026-11-04T14:00:00-05:00" },
    stdio: "inherit",
  });
}
