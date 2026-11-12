import type { ClientMessage, ServerMessage } from "@frontdesk/core";
import type { ChatEvent } from "./state";

export const SESSION_KEY = "frontdesk.sessionId";
/** Close code the api uses when another tab or socket takes over this session. */
export const REPLACED = 4000;
/** Close codes for a socket the api refused (M10): over the chat limits, or the bot check failed. */
export const RATE_LIMITED = 4429;
export const BOT_CHECK_FAILED = 4403;
const BACKOFF_MS = [250, 500, 1000, 2000, 4000];
/**
 * Closes in a row without a `session` (about 8 s of trying) before we tell the caller we can't
 * reach the api, instead of showing "Reconnecting…" forever. We keep trying every 4 s after
 * that, since a sleeping free-tier api can take a while to wake; a `session` clears the notice.
 */
export const MAX_FAILED_OPENS = 6;

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
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** A fresh bot-check token (Turnstile, M10) for opening a new session; none when unset. */
  botToken?: () => Promise<string>;
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
  /** Closes since the last `session`. */
  let failedOpens = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function open() {
    const sessionId = opts.storage.getItem(SESSION_KEY);
    if (sessionId) {
      openUrl(`${opts.url}?sessionId=${encodeURIComponent(sessionId)}`);
    } else if (opts.botToken) {
      // A token is single-use, so each new session asks for its own.
      opts.botToken().then(
        (token) => {
          if (!stopped) openUrl(`${opts.url}?ts=${encodeURIComponent(token)}`);
        },
        // The bot check itself failed (Turnstile errored twice, or the browser isn't supported).
        () => {
          if (!stopped) opts.onEvent({ type: "socket", status: "bot_check_failed" });
        },
      );
    } else {
      openUrl(opts.url);
    }
  }

  function openUrl(url: string) {
    const ws = new Impl(url);
    socket = ws;
    ws.onmessage = (e: MessageEvent<string>) => {
      const message = JSON.parse(e.data) as ServerMessage;
      if (message.type === "session") {
        opts.storage.setItem(SESSION_KEY, message.sessionId);
        attempt = 0;
        failedOpens = 0;
      }
      opts.onEvent({ type: "server", message, at: now() });
    };
    ws.onclose = (e: CloseEvent) => {
      if (stopped || socket !== ws) return;
      // Only the code and reason: the URL carries the one-time bot token.
      console.warn(`chat socket closed: ${e.code}${e.reason ? ` ${e.reason}` : ""}`);
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
        // The stored session can't be resumed; a reload starts a new one with a new token.
        opts.storage.removeItem(SESSION_KEY);
        opts.onEvent({ type: "socket", status: "bot_check_failed" });
        return;
      }
      failedOpens += 1;
      if (failedOpens === MAX_FAILED_OPENS) opts.onEvent({ type: "socket", status: "unreachable" });
      else if (failedOpens < MAX_FAILED_OPENS)
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
