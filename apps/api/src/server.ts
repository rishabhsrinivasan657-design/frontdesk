import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { type Chat, type ChatContext, openChat } from "./chat/connection.js";

/** The largest client frame accepted; a user_text is at most 2000 characters. */
export const MAX_PAYLOAD_BYTES = 16_384;

export interface ServerOptions {
  chat: ChatContext;
  /** Browser origins allowed to open a socket (cross-site WebSocket hijacking). */
  webOrigins: string[];
  logger?: boolean;
}

/** `GET /ws`: one socket ↔ one session (spec §8). `?sessionId=` resumes after a drop (spec §11). */
export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? true });
  void app.register(websocket, { options: { maxPayload: MAX_PAYLOAD_BYTES } });

  app.get("/health", () => ({ ok: true }));

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
          opts.chat.logger.error({ err: error }, "opening the chat failed");
          socket.close(1011, "unavailable");
        });
        socket.on("close", () => {
          void ready.then((chat) => chat.close()).catch(() => undefined);
        });
        socket.on("message", (data: Buffer) => {
          const raw = data.toString("utf8");
          void ready
            .then((chat) => chat.onMessage(raw))
            .catch((error: unknown) => opts.chat.logger.error({ err: error }, "message failed"));
        });
      },
    );
    done();
  });

  return app;
}
