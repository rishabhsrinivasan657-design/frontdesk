import type { PendingAction, SessionState } from "../../agent/types.js";
import type { SessionStore } from "../../ports/session-store.js";
import { deepCopy } from "./copy.js";

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionState>();
  private readonly pending = new Map<string, PendingAction>();

  load(id: string): Promise<SessionState | undefined> {
    return Promise.resolve(deepCopy(this.sessions.get(id)));
  }

  save(state: SessionState): Promise<void> {
    this.sessions.set(state.id, deepCopy(state));
    return Promise.resolve();
  }

  putPending(action: PendingAction): Promise<void> {
    this.pending.set(action.sessionId, deepCopy(action));
    return Promise.resolve();
  }

  getPending(sessionId: string): Promise<PendingAction | undefined> {
    return Promise.resolve(deepCopy(this.pending.get(sessionId)));
  }

  takePending(sessionId: string, actionId: string): Promise<PendingAction | undefined> {
    const action = this.pending.get(sessionId);
    if (action?.id !== actionId) return Promise.resolve(undefined);
    this.pending.delete(sessionId);
    return Promise.resolve(action);
  }

  clearPending(sessionId: string): Promise<PendingAction | undefined> {
    const action = this.pending.get(sessionId);
    this.pending.delete(sessionId);
    return Promise.resolve(action);
  }
}
