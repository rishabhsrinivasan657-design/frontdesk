import type { LiveEvent } from "./types";

/** The parts of an EventSource the live board uses (so tests can fake it). */
export interface StreamLike {
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  addEventListener(type: string, fn: (m: MessageEvent<string>) => void): void;
  close(): void;
}

const CLOSED = 2;
const MAX_DELAY_MS = 15_000;
const EVENT_TYPES: LiveEvent["type"][] = [
  "session_open",
  "session_closed",
  "turn",
  "pending",
  "pending_cleared",
  "handoff",
];

/**
 * Keeps the owner's live stream open. EventSource retries a dropped stream by itself, but gives
 * up for good when a retry gets a non-200 (the api restarting, an expired session). Then this
 * waits 1 s, 2 s, 4 s … up to 15 s, asks whether the session is still valid, and reopens, or
 * sends the owner to login. Returns a stop function.
 */
export function connectLive(o: {
  open: () => StreamLike;
  checkSession: () => Promise<"ok" | "unauthorized" | "unreachable">;
  onEvent: (e: LiveEvent) => void;
  /** Connected: reload the snapshot, since events sent while away are gone. */
  onOpen: () => void;
  onStatus: (s: "live" | "reconnecting") => void;
  onUnauthorized: () => void;
  schedule?: (fn: () => void, ms: number) => () => void;
}): () => void {
  const schedule =
    o.schedule ??
    ((fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    });
  let stopped = false;
  let attempt = 0;
  let stream: StreamLike | undefined;
  let cancel: (() => void) | undefined;

  const start = () => {
    const s = o.open();
    stream = s;
    s.onopen = () => {
      attempt = 0;
      o.onStatus("live");
      o.onOpen();
    };
    s.onerror = () => {
      o.onStatus("reconnecting");
      if (s.readyState !== CLOSED) return;
      s.close();
      const delay = Math.min(1000 * 2 ** attempt, MAX_DELAY_MS);
      attempt++;
      cancel = schedule(() => {
        void o.checkSession().then((session) => {
          if (stopped) return;
          if (session === "unauthorized") o.onUnauthorized();
          else start();
        });
      }, delay);
    };
    for (const type of EVENT_TYPES) {
      s.addEventListener(type, (m) => o.onEvent(JSON.parse(m.data) as LiveEvent));
    }
  };

  start();
  return () => {
    stopped = true;
    cancel?.();
    stream?.close();
  };
}
