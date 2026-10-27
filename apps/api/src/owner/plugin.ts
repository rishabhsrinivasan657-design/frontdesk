import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { COOKIE, checkCredentials } from "./auth.js";
import type { OwnerContext } from "./context.js";
import { clientKey } from "../abuse/chat-limits.js";
import { MAX_LOGIN_ATTEMPTS_PER_HOUR, MAX_LOGIN_FAILURES } from "./session-store.js";

declare module "fastify" {
  interface FastifyContextConfig {
    /** Reachable without an owner session (only the login route). */
    public?: boolean;
  }
}

const LoginBody = z.strictObject({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(1024),
});

/** Extra owner routes (REST, live feed), registered behind the same auth. */
export type OwnerRouteSet = (app: FastifyInstance) => void;

/**
 * Everything under `/owner` (spec §10). Every route requires the owner's session cookie unless
 * its config says `public`; unknown paths fall through to the 404 handler and reach nothing.
 * Mutations must be JSON from an allowed origin (CSRF): a cross-site form can't send JSON.
 */
export function ownerPlugin(
  owner: OwnerContext | undefined,
  webOrigins: string[],
  routeSets: OwnerRouteSet[] = [],
): FastifyPluginCallback {
  return (app, _opts, done) => {
    if (!owner) {
      app.all("/*", (_req, reply) => reply.code(503).send({ error: "owner_disabled" }));
      done();
      return;
    }

    void app.register(cookie);

    app.addHook("onRequest", async (req, reply) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.origin;
        if (origin !== undefined && !webOrigins.includes(origin)) {
          return reply.code(403).send({ error: "origin_not_allowed" });
        }
        if (!req.headers["content-type"]?.startsWith("application/json")) {
          return reply.code(415).send({ error: "json_required" });
        }
      }
      if (req.routeOptions.config.public) return;
      if (!(await hasSession(owner, req))) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });

    app.post("/login", { config: { public: true } }, async (req, reply) => {
      const body = LoginBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "bad_request" });
      // Counted before bcrypt runs, so parallel guesses can't all read "0 failures so far".
      // An IPv6 /64 is one address; the hourly ceiling catches guessing spread over many.
      const who = clientKey(req.ip);
      if (
        (await owner.sessions.attempt(who)) > MAX_LOGIN_FAILURES ||
        (await owner.sessions.attemptAnywhere()) > MAX_LOGIN_ATTEMPTS_PER_HOUR
      ) {
        return reply.code(429).send({ error: "too_many_attempts" });
      }
      if (!(await checkCredentials(owner, body.data.email, body.data.password))) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      await owner.sessions.clearAttempts(who);
      const id = await owner.sessions.create();
      setSessionCookie(reply, owner, id);
      return reply.code(204).send();
    });

    app.post("/logout", async (req, reply) => {
      const id = req.cookies[COOKIE];
      if (id) await owner.sessions.destroy(id);
      void reply.clearCookie(COOKIE, { path: "/" });
      return reply.code(204).send();
    });

    app.get("/me", () => ({ email: owner.email }));

    for (const register of routeSets) register(app);
    done();
  };
}

async function hasSession(owner: OwnerContext, req: FastifyRequest): Promise<boolean> {
  const id = req.cookies[COOKIE];
  return !!id && (await owner.sessions.valid(id));
}

function setSessionCookie(reply: FastifyReply, owner: OwnerContext, id: string): void {
  void reply.setCookie(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(owner.sessionTtlMs / 1000),
    secure: owner.secureCookie,
  });
}
