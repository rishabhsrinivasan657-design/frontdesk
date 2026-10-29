import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** The production stack (M10 Part B), checked through `docker compose config` with the example env. */
const root = resolve(import.meta.dirname, "../..");
const example = resolve(root, "deploy/.env.production.example");

interface Service {
  image?: string;
  build?: { target?: string; args?: Record<string, string> };
  ports?: { published?: string; target: number }[];
  restart?: string;
  env_file?: { path: string }[] | string[];
  environment?: Record<string, string>;
  networks?: Record<string, { ipv4_address?: string } | null>;
  depends_on?: Record<string, { condition: string }>;
}

interface Network {
  ipam?: { config?: { subnet?: string; ip_range?: string }[] };
}

function config(): { services: Record<string, Service>; networks: Record<string, Network> } {
  const out = execFileSync(
    "docker",
    [
      "compose",
      "-f",
      resolve(root, "deploy/compose.prod.yml"),
      "--env-file",
      example,
      "config",
      "--format",
      "json",
    ],
    { encoding: "utf8", env: { ...process.env, FRONTDESK_ENV_FILE: example } },
  );
  return JSON.parse(out) as {
    services: Record<string, Service>;
    networks: Record<string, Network>;
  };
}

describe("deploy/compose.prod.yml", () => {
  const { services, networks } = config();

  it("hands out dynamic addresses only from the upper half, never Caddy's or web's", () => {
    const ipam = networks.frontdesk?.ipam?.config?.[0];
    expect(ipam).toMatchObject({ subnet: "172.30.0.0/24", ip_range: "172.30.0.128/25" });
    for (const name of ["caddy", "web"]) {
      const last = Number(services[name]!.networks?.frontdesk?.ipv4_address?.split(".")[3]);
      expect(last, name).toBeLessThan(128);
    }
  });

  it("has the pilot's services", () => {
    expect(Object.keys(services).sort()).toEqual(
      ["api", "caddy", "migrate", "postgres", "redis", "web", "worker"].sort(),
    );
  });

  it("publishes only Caddy's 80 and 443", () => {
    for (const [name, s] of Object.entries(services)) {
      if (name === "caddy") {
        expect(s.ports?.map((p) => p.target).sort()).toEqual([443, 80]);
      } else {
        expect(s.ports ?? [], name).toEqual([]);
      }
    }
  });

  it("restarts every long-running service", () => {
    for (const [name, s] of Object.entries(services)) {
      if (name !== "migrate") expect(s.restart, name).toBe("unless-stopped");
    }
  });

  it("the api trusts only Caddy's and the web app's fixed addresses for X-Forwarded-For", () => {
    const caddy = services.caddy!.networks?.frontdesk?.ipv4_address;
    const web = services.web!.networks?.frontdesk?.ipv4_address;
    expect(caddy).toBeTruthy();
    expect(web).toBeTruthy();
    expect(services.api!.environment?.TRUST_PROXY).toBe(`${caddy},${web}`);
    expect(services.web!.environment?.TRUST_FORWARDED_FOR).toBe("1");
  });

  it("runs the app in production mode as the pilot, listening inside the network", () => {
    for (const name of ["api", "worker", "web"]) {
      expect(services[name]!.environment?.NODE_ENV, name).toBe("production");
    }
    expect(services.api!.environment?.API_HOST).toBe("0.0.0.0");
    expect(services.api!.environment?.CONVERSATION_SOURCE).toBe("pilot");
    expect(services.worker!.environment?.CONVERSATION_SOURCE).toBe("pilot");
  });

  it("starts the app only after migrations finish", () => {
    for (const name of ["api", "worker"]) {
      expect(services[name]!.depends_on?.migrate?.condition, name).toBe(
        "service_completed_successfully",
      );
    }
  });
});

describe("deploy files hold no secrets and log no visitors", () => {
  it("the example env file has only placeholders", () => {
    const lines = readFileSync(example, "utf8")
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l));
    const SECRET_KEYS = [
      "POSTGRES_PASSWORD",
      "GEMINI_API_KEY",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REFRESH_TOKEN",
      "TURNSTILE_SECRET_KEY",
      "KEY_HASH_SECRET",
      "OWNER_PASSWORD_HASH",
    ];
    for (const key of SECRET_KEYS) {
      const line = lines.find((l) => l.startsWith(`${key}=`));
      expect(line, key).toBeDefined();
      expect(line!.slice(key.length + 1), key).toMatch(/^(|change-me.*|'?\$2b\$12\$change-me.*)$/);
    }
    expect(lines.some((l) => l.startsWith("GEMINI_API_KEY_2="))).toBe(false);
  });

  it("backups keep personal data at most 3 days past the 30-day promise, and /privacy says so", () => {
    const backup = readFileSync(resolve(root, "deploy/backup.sh"), "utf8");
    const days = Number(/-mtime \+(\d+)/.exec(backup)?.[1]);
    // -mtime +N deletes files more than N full days old: they live at most N + 1 days.
    expect(days + 1).toBeLessThanOrEqual(3);
    const privacy = readFileSync(resolve(root, "apps/web/src/app/privacy/page.tsx"), "utf8");
    expect(privacy).toMatch(/backups are kept for 3 days/i);
  });

  it("the Caddyfile has no access log", () => {
    const caddyfile = readFileSync(resolve(root, "deploy/Caddyfile"), "utf8");
    expect(caddyfile).not.toMatch(/^\s*log\b/m);
  });

  it("the image never copies an env file", () => {
    const ignore = readFileSync(resolve(root, ".dockerignore"), "utf8").split("\n");
    expect(ignore).toContain(".env*");
    expect(ignore).toContain("!.env.example");
    expect(ignore).toContain("deploy/.env.production");
  });
});
