import type { ChatSocket } from "./connection.js";

/** Close code for a socket replaced by a newer one on the same session. */
export const REPLACED = 4000;

interface Entry {
  socket: ChatSocket;
  /** The turn this socket is running, if any. */
  inflight?: Promise<void>;
}

export interface Claim {
  /** Settles once the replaced socket's turn (if any) has finished and been saved. */
  previousTurn: Promise<void>;
  /** False once a newer socket has claimed the session. */
  isCurrent(): boolean;
  /** The session's turn in flight, from any socket. */
  busy(): boolean;
  /** Marks a turn in flight; call the returned function when its reply is complete. */
  begin(): () => void;
  release(): void;
}

/**
 * One live socket per session (in this process). A second tab or a reconnect takes over: the
 * old socket is closed, and the new one waits for any turn still running, so the state it
 * restores includes that turn's read-back. Caller text is never confirmed on a socket that
 * didn't see the read-back. A multi-process host also needs a Redis lock per session.
 */
export class SessionHub {
  private readonly live = new Map<string, Entry>();

  claim(sessionId: string, socket: ChatSocket): Claim {
    const previous = this.live.get(sessionId);
    const entry: Entry = { socket };
    this.live.set(sessionId, entry);
    if (previous) previous.socket.close(REPLACED);
    const isCurrent = () => this.live.get(sessionId) === entry;
    return {
      previousTurn: previous?.inflight ?? Promise.resolve(),
      isCurrent,
      busy: () => entry.inflight !== undefined,
      begin: () => {
        let end!: () => void;
        const turn = new Promise<void>((resolve) => (end = resolve));
        entry.inflight = turn;
        return () => {
          if (entry.inflight === turn) delete entry.inflight;
          end();
        };
      },
      release: () => {
        if (isCurrent()) this.live.delete(sessionId);
      },
    };
  }
}
