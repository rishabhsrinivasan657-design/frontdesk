import type { ClientMessage, ServerMessage } from "@frontdesk/core";
import type { ChatEvent } from "./state";

export const SESSION_KEY = "frontdesk.sessionId";
/** Close code the api uses when another tab or socket takes over this session. */
export const REPLACED = 4000;
const BACKOFF_MS = [250, 500, 1000, 2000, 4000];

export interface ChatConnection {
  /** Sends the caller's text. False if the socket isn't open (nothing is queued). */
  sendText(text: string): boolean;
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
      opts.onEvent({ type: "socket", status: "reconnecting" });
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
      attempt += 1;
      timer = setTimeout(open, delay);
    };
  }

  open();

  return {
    sendText(text) {
      if (!socket || socket.readyState !== Impl.OPEN) return false;
      const message: ClientMessage = { type: "user_text", text, timings: {} };
      socket.send(JSON.stringify(message));
      return true;
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    },
  };
}
