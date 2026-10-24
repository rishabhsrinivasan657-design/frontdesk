import type { ChatSocket } from "./connection.js";

/** Close code for a socket replaced by a newer one on the same session. */
export const REPLACED = 4000;

export interface Turn {
  /** The whole reply was sent (turn_metrics): the caller may send their next message. */
  replied(): void;
  /** The turn finished, session saved. */
  done(): void;
}

export interface Claim {
  /** False once a newer socket has claimed the session. */
  isCurrent(): boolean;
  /** This session is still answering; a new message gets `busy`. */
  busy(): boolean;
  begin(): Turn;
  release(): void;
}

/**
 * One live socket per session (in this process), and the turn each session has in flight.
 * A second tab or a reconnect takes over: the old socket is closed, and the new one waits for
 * any turn still running (even one whose socket already closed, as on a page reload), so the
 * state it restores includes that turn's read-back. Caller text is never confirmed on a socket
 * that didn't see the read-back. A multi-process host also needs a Redis lock per session.
 */
export class SessionHub {
  private readonly sockets = new Map<string, ChatSocket>();
  private readonly turns = new Map<string, Promise<void>>();

  /** Sessions with a live socket right now, for the owner's Live view. */
  activeSessions(): string[] {
    return [...this.sockets.keys()];
  }

  /** Settles once the session's turn in flight, from any socket, has finished and been saved. */
  settled(sessionId: string): Promise<void> {
    return this.turns.get(sessionId) ?? Promise.resolve();
  }

  claim(sessionId: string, socket: ChatSocket): Claim {
    const previous = this.sockets.get(sessionId);
    this.sockets.set(sessionId, socket);
    if (previous && previous !== socket) previous.close(REPLACED);
    let answering = false;
    const isCurrent = () => this.sockets.get(sessionId) === socket;
    return {
      isCurrent,
      busy: () => answering,
      begin: () => {
        answering = true;
        let finish!: () => void;
        const turn = new Promise<void>((resolve) => (finish = resolve));
        this.turns.set(sessionId, turn);
        return {
          replied: () => {
            answering = false;
          },
          done: () => {
            answering = false;
            if (this.turns.get(sessionId) === turn) this.turns.delete(sessionId);
            finish();
          },
        };
      },
      release: () => {
        // The turn in flight stays tracked: a reload's new socket must still wait for it.
        if (isCurrent()) this.sockets.delete(sessionId);
      },
    };
  }
}
