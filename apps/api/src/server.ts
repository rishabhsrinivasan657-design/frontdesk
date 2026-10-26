import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { BotCheck } from "./abuse/bot-check.js";
import type { ChatGuard } from "./abuse/chat-limits.js";
import { type Chat, type ChatContext, openChat } from "./chat/connection.js";
import { safeError, safeRequest } from "./chat/log-safety.js";
import type { OwnerContext } from "./owner/context.js";
import { type OwnerRouteSet, ownerPlugin } from "./owner/plugin.js";

/** The largest client frame accepted; a user_text is at most 2000 characters. */
export const MAX_PAYLOAD_BYTES = 16_384;

export interface ServerOptions {
  chat: ChatContext;
  /** Browser origins allowed to open a socket (cross-site WebSocket hijacking). */
  webOrigins: string[];
  /** The owner dashboard api; undefined answers 503 on every `/owner` route. */
  owner?: OwnerContext;
  /** Owner routes beyond login/logout/me (REST, live feed). */
  ownerRoutes?: OwnerRouteSet[];
  /** A new chat session must pass this check (`?ts=<token>`, M10); none when undefined. */
  botCheck?: BotCheck;
  /** Per-IP and per-session limits on the public chat (M10); none when undefined. */
  chatGuard?: ChatGuard;
  /** Peers allowed to say who the client is (X-Forwarded-For). Defaults to loopback only. */
  trustProxy?: string[];
  /** false for silence; a stream to capture log lines (tests). Defaults to stdout. */
  logger?: boolean | { stream: { write(line: string): void } };
}

/** Close code for a socket refused by the chat limits (M10). */
export const RATE_LIMITED = 4429;
/** Close code for a new session whose bot check failed (M10). */
export const BOT_CHECK_FAILED = 4403;
/** A session that passed the bot check may reconnect for this long before its first turn. */
const VERIFIED_TTL_MS = 3_600_000;

/** `GET /ws`: one socket ↔ one session (spec §8). `?sessionId=` resumes after a drop (spec §11). */
export function buildServer(opts: ServerOptions): FastifyInstance {
  const logger = opts.logger ?? true;
  const app = Fastify({
    // The web app's owner proxy runs on this machine and forwards the browser's address, so
    // per-IP login limits see the visitor, not the proxy. Only loopback is trusted to say so.
    trustProxy: opts.trustProxy ?? ["127.0.0.1", "::1"],
    logger:
      logger === false
        ? false
        : {
            ...(logger === true ? {} : { stream: logger.stream }),
            serializers: { req: safeRequest },
          },
  });
  void app.register(websocket, { options: { maxPayload: MAX_PAYLOAD_BYTES } });

  app.get("/health", () => ({ ok: true }));
  void app.register(ownerPlugin(opts.owner, opts.webOrigins, opts.ownerRoutes), {
    prefix: "/owner",
  });

  // Sessions that passed the bot check but may not be stored yet (no turn), by expiry time.
  const verified = new Map<string, number>();
  /** Resuming a known session needs no new token: the session id is already the credential. */
  async function mayResume(sessionId: string | undefined): Promise<boolean> {
    if (!sessionId) return false;
    const until = verified.get(sessionId);
    if (until !== undefined && until > Date.now()) return true;
    verified.delete(sessionId);
    await opts.chat.hub.settled(sessionId);
    return (await opts.chat.deps.sessions.load(sessionId)) !== undefined;
  }

  void app.register((scoped, _o, done) => {
    scoped.get<{ Querystring: { sessionId?: string; ts?: string } }>(
      "/ws",
      { websocket: true },
      (socket, req) => {
        // Browsers always send Origin; a page on another site must not talk as its visitor.
        const origin = req.headers.origin;
        if (origin !== undefined && !opts.webOrigins.includes(origin)) {
          socket.close(1008, "origin not allowed");
          return;
        }
        const guard = opts.chatGuard;
        const ip = req.ip;
        const peer = {
          send: (text: string) => socket.send(text),
          close: (code?: number) => socket.close(code),
        };
        // Registered before the limits and openChat resolve, so no early message is lost.
        const ready: Promise<Chat | undefined> = (async () => {
          if (guard) {
            const verdict = await guard.connect(ip);
            if (verdict !== "ok") {
              socket.close(RATE_LIMITED, "rate limited");
              return undefined;
            }
            socket.on("close", () => guard.release(ip));
          }
          const requested =
            typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
          const bot = opts.botCheck;
          let checked = false;
          if (bot && !(await mayResume(requested))) {
            const token = typeof req.query.ts === "string" ? req.query.ts : "";
            if (!(await bot.verify(token, ip))) {
              socket.close(BOT_CHECK_FAILED, "bot check failed");
              return undefined;
            }
            checked = true;
          }
          if (requested) verified.delete(requested);
          const chat = await openChat(
            peer,
            opts.chat,
            requested,
            guard ? { allowTurn: (sessionId) => guard.turn(ip, sessionId) } : {},
          );
          // Only a session that just passed the check earns a token-free reconnect, once.
          if (checked) {
            verified.set(chat.sessionId, Date.now() + VERIFIED_TTL_MS);
            for (const [id, until] of verified) if (until <= Date.now()) verified.delete(id);
          }
          return chat;
        })();
        ready.catch((error: unknown) => {
          opts.chat.logger.error({ err: safeError(error) }, "opening the chat failed");
          socket.close(1011, "unavailable");
        });
        socket.on("close", () => {
          void ready.then((chat) => chat?.close()).catch(() => undefined);
        });
        socket.on("message", (data: Buffer) => {
          const raw = data.toString("utf8");
          void ready
            .then((chat) => chat?.onMessage(raw))
            .catch((error: unknown) =>
              opts.chat.logger.error({ err: safeError(error) }, "message failed"),
            );
        });
      },
    );
    done();
  });

  return app;
}
