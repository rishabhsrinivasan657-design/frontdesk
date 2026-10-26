import type { ClientMessage, ServerMessage } from "@frontdesk/core";
import type { ChatEvent } from "./state";

export const SESSION_KEY = "frontdesk.sessionId";
/** Close code the api uses when another tab or socket takes over this session. */
export const REPLACED = 4000;
/** Close codes for a socket the api refused (M10): over the chat limits, or the bot check failed. */
export const RATE_LIMITED = 4429;
export const BOT_CHECK_FAILED = 4403;
const BACKOFF_MS = [250, 500, 1000, 2000, 4000];

export interface ChatConnection {
  /** Sends the caller's text (typed, or a voice transcript with its timings). False if not open. */
  sendText(text: string, timings?: { speechEnd?: number; sttFinal?: number }): boolean;
  /** Barge-in: asks the server to cancel the reply in flight. */
  sendInterrupt(): boolean;
  /** The first sentence of `turnId` started playing. */
  sendTtsStarted(turnId: string, at: number): boolean;
  /** The post-conversation rating (spec §12). */
  sendFeedback(rating: number, comment: string): boolean;
  close(): void;
}

export interface ConnectOptions {
  url: string;
  storage: Pick<Storage, "getItem" | "setItem">;
  onEvent(event: ChatEvent): void;
  WebSocketImpl?: typeof WebSocket;
  now?: () => number;
}

/**
 * Opens the chat socket and keeps it open (spec §11). The server-issued session id is kept in
 * sessionStorage, and every reconnect sends it back so the conversation is restored.
 */
export function connectChat(opts: ConnectOptions): ChatConnection {
  const Impl = opts.WebSocketImpl ?? WebSocket;
  const now = opts.now ?? (() => performance.now());
  let socket: WebSocket | undefined;
  let attempt = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function open() {
    const sessionId = opts.storage.getItem(SESSION_KEY);
    const url = sessionId ? `${opts.url}?sessionId=${encodeURIComponent(sessionId)}` : opts.url;
    const ws = new Impl(url);
    socket = ws;
    ws.onmessage = (e: MessageEvent<string>) => {
      const message = JSON.parse(e.data) as ServerMessage;
      if (message.type === "session") {
        opts.storage.setItem(SESSION_KEY, message.sessionId);
        attempt = 0;
      }
      opts.onEvent({ type: "server", message, at: now() });
    };
    ws.onclose = (e: CloseEvent) => {
      if (stopped || socket !== ws) return;
      if (e.code === REPLACED) {
        // Another tab has this conversation now; reconnecting would take it back and forth.
        opts.onEvent({ type: "socket", status: "replaced" });
        return;
      }
      // Retrying would only count against the limits again, or fail the same check.
      if (e.code === RATE_LIMITED) {
        opts.onEvent({ type: "socket", status: "limited" });
        return;
      }
      if (e.code === BOT_CHECK_FAILED) {
        opts.onEvent({ type: "socket", status: "bot_check_failed" });
        return;
      }
      opts.onEvent({ type: "socket", status: "reconnecting" });
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
      attempt += 1;
      timer = setTimeout(open, delay);
    };
  }

  open();

  function send(message: ClientMessage): boolean {
    if (!socket || socket.readyState !== Impl.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  return {
    sendText: (text, timings = {}) => send({ type: "user_text", text, timings }),
    sendInterrupt: () => send({ type: "interrupt" }),
    sendTtsStarted: (turnId, at) => send({ type: "tts_started", turnId, at }),
    sendFeedback: (rating, comment) => send({ type: "feedback", rating, comment }),
    close() {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    },
  };
}
