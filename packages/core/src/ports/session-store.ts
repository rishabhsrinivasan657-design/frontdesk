import type { PendingAction, SessionState } from "../agent/types.js";

export interface SessionStore {
  load(id: string): Promise<SessionState | undefined>;
  save(state: SessionState): Promise<void>;
  /** Stores the session's one pending action, replacing any existing one. */
  putPending(action: PendingAction): Promise<void>;
  getPending(sessionId: string): Promise<PendingAction | undefined>;
  /** Atomically removes and returns the pending action only if its id matches (Redis GETDEL in M6). */
  takePending(sessionId: string, actionId: string): Promise<PendingAction | undefined>;
  clearPending(sessionId: string): Promise<PendingAction | undefined>;
}
