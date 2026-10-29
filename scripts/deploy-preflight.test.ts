import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** deploy/deploy.sh's checks before it touches git or Docker (M10 review). */
const script = resolve(import.meta.dirname, "../deploy/deploy.sh");

const GOOD = [
  "SITE_HOST=casa.duckdns.org",
  "OWNER_PASSWORD_HASH='$2b$12$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234'",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAA",
];

function preflight(lines: string[], mode = 0o600): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "fd-deploy-"));
  const env = join(dir, ".env.production");
  writeFileSync(env, `${lines.join("\n")}\n`);
  chmodSync(env, mode);
  try {
    const out = execFileSync("bash", [script, "v2026.11.02"], {
      encoding: "utf8",
      env: { ...process.env, FRONTDESK_ENV_FILE: env, FRONTDESK_PREFLIGHT_ONLY: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status: number; stdout: string };
    return { code: e.status, out: e.stdout };
  }
}

describe("deploy.sh preflight", () => {
  it("passes a complete, locked-down env file", () => {
    expect(preflight(GOOD)).toMatchObject({ code: 0 });
  });

  it("refuses an env file others can read", () => {
    const r = preflight(GOOD, 0o644);
    expect(r.code).toBe(1);
    expect(r.out).toContain("chmod 600");
  });

  it("refuses an owner hash without single quotes (Compose would mangle its $ signs)", () => {
    const r = preflight([
      GOOD[0]!,
      "OWNER_PASSWORD_HASH=$2b$12$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234",
      GOOD[2]!,
    ]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("single quotes");
  });

  it("refuses an empty Turnstile site key (every chat would fail the bot check)", () => {
    const r = preflight([GOOD[0]!, GOOD[1]!, "NEXT_PUBLIC_TURNSTILE_SITE_KEY="]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  });

  it("never prints the env file's values", () => {
    const r = preflight([GOOD[0]!, GOOD[1]!, "NEXT_PUBLIC_TURNSTILE_SITE_KEY="]);
    expect(r.out).not.toContain("abcdefghijklmnop");
  });
});
