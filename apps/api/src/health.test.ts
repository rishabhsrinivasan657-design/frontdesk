import { describe, expect, it } from "vitest";
import { readiness } from "./health.js";

const ok = () => Promise.resolve(true);
const bad = () => Promise.resolve(false);

describe("readiness", () => {
  it("is ok when every check passes", async () => {
    const check = readiness({ redis: ok, postgres: ok, google: ok, worker: ok });
    expect(await check()).toEqual({
      ok: true,
      checks: { redis: "ok", postgres: "ok", google: "ok", worker: "ok" },
    });
  });

  it("fails and names google when the token check fails", async () => {
    const check = readiness({ redis: ok, postgres: ok, google: bad, worker: ok });
    expect(await check()).toEqual({
      ok: false,
      checks: { redis: "ok", postgres: "ok", google: "fail", worker: "ok" },
    });
  });

  it("never includes error text: a throwing check is just fail", async () => {
    const check = readiness({
      redis: () => Promise.reject(new Error("token ya29.secret refused")),
      postgres: ok,
      google: ok,
      worker: bad,
    });
    const body = await check();
    expect(JSON.stringify(body)).not.toContain("ya29");
    expect(body.checks).toEqual({ redis: "fail", postgres: "ok", google: "ok", worker: "fail" });
  });

  it("caches the google check for 5 minutes", async () => {
    let calls = 0;
    let now = 0;
    const check = readiness(
      { redis: ok, postgres: ok, google: () => (calls++, Promise.resolve(true)), worker: ok },
      { now: () => now },
    );
    await check();
    await check();
    now += 299_000;
    await check();
    expect(calls).toBe(1);
    now += 2_000;
    await check();
    expect(calls).toBe(2);
  });

  it("a hung check fails after the timeout instead of hanging the endpoint", async () => {
    const check = readiness(
      { redis: () => new Promise(() => undefined), postgres: ok, google: ok, worker: ok },
      { timeoutMs: 20 },
    );
    expect((await check()).checks.redis).toBe("fail");
  });
});
