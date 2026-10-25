import bcrypt from "bcryptjs";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatContext } from "../chat/connection.js";
import { InMemoryConversationLog } from "../chat/conversation-log.js";
import { SessionHub } from "../chat/hub.js";
import { buildServer } from "../server.js";
import { memoryDeps } from "../test-deps.js";
import { OwnerFeed } from "./feed.js";
import { ownerLiveRoutes } from "./live.js";
import type { OwnerReads } from "./reads.js";
import { ownerRestRoutes } from "./routes.js";
import { testOwner } from "./test-owner.js";

const ORIGIN = "http://localhost:3000";
const EMAIL = "owner@casafiorella.test";
const PASSWORD = "correct horse battery staple";
const HASH = bcrypt.hashSync(PASSWORD, 4);

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function chat(): ChatContext {
  return {
    deps: memoryDeps(),
    log: new InMemoryConversationLog(),
    price: { input: 0, output: 0 },
    newSessionId: () => "sess_1",
    logger: { error: vi.fn() },
    hub: new SessionHub(),
  };
}

/** Builds the server and records every route registered under /owner. */
async function start(withOwner = true) {
  const owner = withOwner ? testOwner({ email: EMAIL, passwordHash: HASH }) : undefined;
  const c = chat();
  // Every route set the api registers, so the guard test sees all of them.
  const ownerRoutes = [
    ownerRestRoutes({ reads: {} as OwnerReads, calendarId: null, now: () => new Date() }),
    ownerLiveRoutes({
      hub: c.hub,
      sessions: c.deps.sessions,
      clock: c.deps.clock,
      feed: new OwnerFeed(),
    }),
  ];
  app = buildServer({
    chat: c,
    webOrigins: [ORIGIN],
    logger: false,
    ownerRoutes,
    ...(owner ? { owner } : {}),
  });
  const routes: { method: string; url: string }[] = [];
  app.addHook("onRoute", (r) => {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    for (const method of methods) {
      if (r.url.startsWith("/owner") && method !== "HEAD") routes.push({ method, url: r.url });
    }
  });
  await app.ready();
  return { app, routes, owner };
}

const json = { "content-type": "application/json", origin: ORIGIN };
const login = (a: FastifyInstance, body: unknown, ip = "10.0.0.1") =>
  a.inject({
    method: "POST",
    url: "/owner/login",
    headers: json,
    payload: JSON.stringify(body),
    remoteAddress: ip,
  });

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const first = Array.isArray(raw) ? String(raw[0]) : String(raw);
  return first.split(";")[0]!;
}

describe("owner auth", () => {
  it("logs in with the right password and sets an httpOnly cookie", async () => {
    const { app } = await start();
    const res = await login(app, { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(204);
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toMatch(/^fd_owner=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Secure");
    const me = await app.inject({ url: "/owner/me", headers: { cookie: cookieOf(res) } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ email: EMAIL });
  });

  it("accepts the email in any case", async () => {
    const { app } = await start();
    expect(
      (await login(app, { email: " Owner@CasaFiorella.test ", password: PASSWORD })).statusCode,
    ).toBe(204);
  });

  it("same response for unknown email", async () => {
    const { app } = await start();
    const compare = vi.spyOn(bcrypt, "compare");
    const wrongPassword = await login(app, { email: EMAIL, password: "nope" });
    const unknownEmail = await login(app, { email: "who@example.com", password: PASSWORD });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(unknownEmail.json()).toEqual(wrongPassword.json());
    expect(unknownEmail.headers["set-cookie"]).toBeUndefined();
    // bcrypt runs for an unknown email too, so timing doesn't reveal which emails exist.
    expect(compare).toHaveBeenCalledTimes(2);
    compare.mockRestore();
  });

  it("rate-limits failed logins", async () => {
    const { app } = await start();
    for (let i = 0; i < 5; i++) {
      expect((await login(app, { email: EMAIL, password: "nope" })).statusCode).toBe(401);
    }
    const blocked = await login(app, { email: EMAIL, password: PASSWORD });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({ error: "too_many_attempts" });
    expect((await login(app, { email: EMAIL, password: PASSWORD }, "10.0.0.2")).statusCode).toBe(
      204,
    );
  });

  it("parallel guesses can't beat the rate limit", async () => {
    const { app } = await start();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => login(app, { email: EMAIL, password: "nope" })),
    );
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 401)).toHaveLength(5);
    expect(codes.filter((c) => c === 429)).toHaveLength(15);
  });

  it("a successful login clears earlier failures", async () => {
    const { app } = await start();
    for (let i = 0; i < 4; i++) await login(app, { email: EMAIL, password: "nope" });
    expect((await login(app, { email: EMAIL, password: PASSWORD })).statusCode).toBe(204);
    for (let i = 0; i < 4; i++) {
      expect((await login(app, { email: EMAIL, password: "nope" })).statusCode).toBe(401);
    }
  });

  it("rejects a malformed login body", async () => {
    const { app } = await start();
    expect((await login(app, { email: EMAIL })).statusCode).toBe(400);
    expect((await login(app, { email: EMAIL, password: "x".repeat(1025) })).statusCode).toBe(400);
  });

  it("every registered owner route rejects a missing or forged cookie", async () => {
    const { app, routes } = await start();
    const guarded = routes.filter((r) => r.url !== "/owner/login");
    expect(guarded.map((r) => `${r.method} ${r.url}`)).toEqual(
      expect.arrayContaining([
        "GET /owner/conversations/:id",
        "POST /owner/handoffs/:id/resolve",
        "GET /owner/metrics",
        "GET /owner/live/stream",
      ]),
    );
    for (const r of guarded) {
      const url = r.url.replace(/:[a-zA-Z]+/g, "x");
      for (const cookie of [undefined, "fd_owner=forged", "fd_owner="]) {
        const opts: InjectOptions = {
          method: r.method,
          url,
          headers: { ...json, ...(cookie ? { cookie } : {}) },
          ...(r.method === "POST" ? { payload: "{}" } : {}),
        };
        const res = await app.inject(opts);
        expect(res.statusCode, `${r.method} ${r.url} cookie=${cookie}`).toBe(401);
      }
    }
  });

  it("logout invalidates the session", async () => {
    const { app } = await start();
    const cookie = cookieOf(await login(app, { email: EMAIL, password: PASSWORD }));
    const out = await app.inject({
      method: "POST",
      url: "/owner/logout",
      headers: { ...json, cookie },
      payload: "{}",
    });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers["set-cookie"])).toMatch(/^fd_owner=;/);
    expect((await app.inject({ url: "/owner/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("rejects a POST from a foreign origin", async () => {
    const { app } = await start();
    const cookie = cookieOf(await login(app, { email: EMAIL, password: PASSWORD }));
    const res = await app.inject({
      method: "POST",
      url: "/owner/logout",
      headers: { "content-type": "application/json", origin: "https://evil.example", cookie },
      payload: "{}",
    });
    expect(res.statusCode).toBe(403);
    const crossLogin = await app.inject({
      method: "POST",
      url: "/owner/login",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      payload: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(crossLogin.statusCode).toBe(403);
  });

  it("rejects a form-encoded POST", async () => {
    const { app } = await start();
    const res = await app.inject({
      method: "POST",
      url: "/owner/login",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      payload: "email=a&password=b",
    });
    expect([403, 415]).toContain(res.statusCode);
  });

  it("owner routes answer 503 when no owner is configured", async () => {
    const { app } = await start(false);
    const res = await app.inject({ url: "/owner/me" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "owner_disabled" });
    expect((await login(app, { email: EMAIL, password: PASSWORD })).statusCode).toBe(503);
  });

  it("sets Secure on the cookie when configured", async () => {
    app = buildServer({
      chat: chat(),
      webOrigins: [ORIGIN],
      logger: false,
      owner: testOwner({ email: EMAIL, passwordHash: HASH, secureCookie: true }),
    });
    expect(
      String((await login(app, { email: EMAIL, password: PASSWORD })).headers["set-cookie"]),
    ).toContain("Secure");
  });
});
