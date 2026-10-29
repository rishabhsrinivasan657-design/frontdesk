import { describe, expect, it } from "vitest";
import { runSmoke, type SmokeDeps } from "./smoke-lib.js";

const BASE = "https://casa.duckdns.org";

/** A deployed site that passes every check; `broken` lets a test break one thing. */
function site(broken: Partial<Record<string, true>> = {}): SmokeDeps {
  const headers = (extra: Record<string, string> = {}) =>
    new Headers({
      ...(broken.hsts ? {} : { "strict-transport-security": "max-age=31536000" }),
      ...extra,
    });
  return {
    fetch: (url, init) => {
      const u = new URL(url);
      if (u.protocol === "http:") {
        return Promise.resolve(
          new Response(null, {
            status: broken.redirect ? 200 : 308,
            headers: { location: `${BASE}/` },
          }),
        );
      }
      const page = (status: number, body: string, h = headers()) =>
        Promise.resolve(new Response(body, { status, headers: h }));
      switch (u.pathname) {
        case "/health/ready":
          return broken.ready
            ? page(503, JSON.stringify({ ok: false, checks: { google: "fail" } }))
            : page(200, JSON.stringify({ ok: true }));
        case "/talk":
          return page(200, "… is stored for up to 30 days to run and improve …");
        case "/privacy":
          return page(200, "<h1>Privacy</h1>");
        case "/api/owner/me":
          return page(broken.ownerOpen ? 200 : 401, "{}");
        case "/dashboard":
          expect(init?.redirect).toBe("manual");
          return page(307, "", headers({ location: "/login?next=%2Fdashboard" }));
        default:
          return page(404, "");
      }
    },
    openWs: (url, origin) => {
      const u = new URL(url);
      if (origin !== BASE) return Promise.resolve(broken.origin ? 1000 : 1008);
      if (!u.searchParams.has("ts")) return Promise.resolve(broken.botCheck ? 1000 : 4403);
      return Promise.resolve(4403);
    },
  };
}

describe("runSmoke", () => {
  it("passes on a good site", async () => {
    const results = await runSmoke(BASE, site());
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.map((r) => r.name)).toEqual([
      "ready",
      "talk shows the privacy notice",
      "privacy page",
      "chat needs the bot check",
      "chat refuses a foreign origin",
      "owner api needs login",
      "dashboard redirects to login",
      "HSTS header",
      "http redirects to https",
    ]);
  });

  it.each([
    ["hsts", "HSTS header"],
    ["ready", "ready"],
    ["botCheck", "chat needs the bot check"],
    ["origin", "chat refuses a foreign origin"],
    ["ownerOpen", "owner api needs login"],
    ["redirect", "http redirects to https"],
  ])("fails %s when that is broken", async (what, name) => {
    const results = await runSmoke(BASE, site({ [what]: true }));
    expect(results.find((r) => r.name === name)?.ok).toBe(false);
  });

  it("a check that throws is a failure, not a crash", async () => {
    const deps = site();
    deps.fetch = () => Promise.reject(new Error("ECONNREFUSED"));
    const results = await runSmoke(BASE, deps);
    expect(results.every((r) => !r.ok)).toBe(false);
    expect(results.find((r) => r.name === "ready")?.ok).toBe(false);
  });
});
