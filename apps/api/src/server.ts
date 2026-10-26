import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
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
  /** Peers allowed to say who the client is (X-Forwarded-For). Defaults to loopback only. */
  trustProxy?: string[];
  /** false for silence; a stream to capture log lines (tests). Defaults to stdout. */
  logger?: boolean | { stream: { write(line: string): void } };
}

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

  void app.register((scoped, _o, done) => {
    scoped.get<{ Querystring: { sessionId?: string } }>(
      "/ws",
      { websocket: true },
      (socket, req) => {
        // Browsers always send Origin; a page on another site must not talk as its visitor.
        const origin = req.headers.origin;
        if (origin !== undefined && !opts.webOrigins.includes(origin)) {
          socket.close(1008, "origin not allowed");
          return;
        }
        // Registered before openChat resolves, so no early message is lost.
        const ready: Promise<Chat> = openChat(
          { send: (text) => socket.send(text), close: (code) => socket.close(code) },
          opts.chat,
          typeof req.query.sessionId === "string" ? req.query.sessionId : undefined,
        );
        ready.catch((error: unknown) => {
          opts.chat.logger.error({ err: safeError(error) }, "opening the chat failed");
          socket.close(1011, "unavailable");
        });
        socket.on("close", () => {
          void ready.then((chat) => chat.close()).catch(() => undefined);
        });
        socket.on("message", (data: Buffer) => {
          const raw = data.toString("utf8");
          void ready
            .then((chat) => chat.onMessage(raw))
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
